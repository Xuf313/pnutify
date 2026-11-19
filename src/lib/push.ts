import webpush, { type PushSubscription } from 'web-push';
import { getRedis, KEYS, withLock } from './redis';
import { refreshNotices, type Notice } from './notices';

export type Categories = { cse: boolean; international: boolean; tasks: boolean };
/** Nothing is on until the student turns it on. */
export const DEFAULT_CATEGORIES: Categories = { cse: false, international: false, tasks: false };

export function normalizeCategories(value: unknown): Categories {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    cse: v.cse === true,
    international: v.international === true,
    tasks: v.tasks === true,
  };
}

export type PushPayload = { title: string; body: string; url: string; tag: string };

/** A notice only triggers a push while it's fresh: seen in the last day and posted in the last 3. */
const NOTICE_PUSH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NOTICE_POST_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_INDIVIDUAL_NOTICE_PUSHES = 3;
const REMINDERS = [
  { key: '24h', withinMs: 24 * 60 * 60 * 1000 },
  { key: '1h', withinMs: 60 * 60 * 1000 },
] as const;

type StoredTask = { id: string; title: string; course?: string; dueDate: number | string };

function configureVapid(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://www.pnutify.app', pub, priv);
  return true;
}

function statusOf(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null && 'statusCode' in err ? (err as { statusCode?: number }).statusCode : undefined;
}

/** 404/410 mean the browser dropped the subscription. 403 usually means a VAPID key mismatch — don't delete everyone over that. */
const isGone = (err: unknown) => [404, 410].includes(statusOf(err) ?? 0);

function noticeTarget(n: Notice): string {
  return `/?tab=notices&notice=${encodeURIComponent(n.id)}`;
}

export function hoursText(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.round(mins / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

export type RunReport = {
  ok: boolean;
  skipped?: string;
  noticeCount: number;
  freshNotices: number;
  devices: number;
  sent: number;
  pruned: number;
  staleSources: string[];
};

export async function runNotificationCycle(now = Date.now()): Promise<RunReport> {
  const redis = getRedis();
  const empty: RunReport = { ok: false, noticeCount: 0, freshNotices: 0, devices: 0, sent: 0, pruned: 0, staleSources: [] };
  if (!redis) return { ...empty, skipped: 'redis-not-configured' };

  const result = await withLock(redis, KEYS.runLock, 55, async (): Promise<RunReport> => {
    const snapshot = await refreshNotices(now);
    const hasVapid = configureVapid();

    // ---- Which notices haven't been pushed yet? ----
    let pushed = await redis.get<string[]>(KEYS.pushedNotices);
    if (!Array.isArray(pushed)) {
      // First run of this version: carry over the old seen-list so nobody gets
      // a flood of notices they were already told about.
      const legacy = await redis.get<string[]>(KEYS.legacySeen);
      pushed = Array.isArray(legacy) && legacy.length > 0 ? legacy : snapshot.notices.map((n) => n.id);
    }
    const pushedSet = new Set(pushed);
    const fresh = snapshot.notices.filter(
      (n) =>
        !pushedSet.has(n.id) &&
        now - n.firstSeenAt <= NOTICE_PUSH_MAX_AGE_MS &&
        (n.postedAt === null || now - n.postedAt <= NOTICE_POST_MAX_AGE_MS),
    );

    // Mark them pushed up front: a notice is offered once, even if some device fails.
    const currentIds = new Set(snapshot.notices.map((n) => n.id));
    const nextPushed = [...new Set([...pushed.filter((id) => currentIds.has(id)), ...snapshot.notices.map((n) => n.id)])];
    await redis.set(KEYS.pushedNotices, nextPushed);

    const deviceIds = (await redis.smembers(KEYS.devices).catch(() => [])) as string[];
    let sent = 0;
    let pruned = 0;

    const handleDevice = async (deviceId: string) => {
      const [subscription, rawCategories] = await Promise.all([
        redis.get<PushSubscription>(KEYS.subscription(deviceId)),
        redis.get<unknown>(KEYS.categories(deviceId)),
      ]);
      if (!subscription || typeof subscription !== 'object' || !('endpoint' in subscription)) {
        await redis.srem(KEYS.devices, deviceId);
        pruned++;
        return;
      }
      if (!hasVapid) return;
      const categories = normalizeCategories(rawCategories);
      const payloads: PushPayload[] = [];

      const mine = fresh.filter((n) => categories[n.source]);
      if (mine.length > MAX_INDIVIDUAL_NOTICE_PUSHES) {
        payloads.push({
          title: `${mine.length} new PNU notices`,
          body: mine.slice(0, 3).map((n) => `• ${n.title}`).join('\n'),
          url: '/?tab=notices',
          tag: 'notices-summary',
        });
      } else {
        for (const n of mine) {
          payloads.push({
            title: n.source === 'cse' ? 'New CSE notice' : 'New International notice',
            body: n.title,
            url: noticeTarget(n),
            tag: `notice-${n.id}`,
          });
        }
      }

      const notifiedKey = KEYS.notifiedDeadlines(deviceId);
      let notified: string[] = [];
      const newlyNotified: string[] = [];
      if (categories.tasks) {
        const tasks = (await redis.get<StoredTask[]>(KEYS.tasks(deviceId))) ?? [];
        notified = (await redis.get<string[]>(notifiedKey)) ?? [];
        const notifiedSet = new Set(notified);
        for (const task of tasks) {
          const due = typeof task.dueDate === 'number' ? task.dueDate : Date.parse(task.dueDate);
          if (Number.isNaN(due) || due <= now) continue;
          const left = due - now;
          // Only the tightest reminder that applies, and only once per (task, due date, reminder).
          const reminder = [...REMINDERS].reverse().find((r) => left <= r.withinMs);
          if (!reminder) continue;
          const key = `${task.id}@${due}@${reminder.key}`;
          if (notifiedSet.has(key)) continue;
          newlyNotified.push(key);
          // Mark the looser reminder as done too, so a task added 30 min before
          // its deadline doesn't get the 24h one on the next run.
          if (reminder.key === '1h') newlyNotified.push(`${task.id}@${due}@24h`);
          payloads.push({
            title: `Due in ${hoursText(left)}`,
            body: task.course && task.course !== 'General' ? `${task.title} · ${task.course}` : task.title,
            url: '/?tab=tasks',
            tag: `task-${task.id}`,
          });
        }
      }

      for (const payload of payloads) {
        try {
          await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 6 * 60 * 60, urgency: 'normal' });
          sent++;
        } catch (err) {
          if (isGone(err)) {
            await Promise.all([
              redis.del(KEYS.subscription(deviceId)),
              redis.del(KEYS.categories(deviceId)),
              redis.srem(KEYS.devices, deviceId),
            ]);
            pruned++;
            return;
          }
          console.error(`[push] send failed for ${deviceId}: ${statusOf(err) ?? ''}`);
        }
      }

      if (newlyNotified.length > 0) {
        // Keep the list bounded.
        await redis.set(notifiedKey, [...notified, ...newlyNotified].slice(-300), { ex: 45 * 24 * 60 * 60 });
      }
    };

    // Small batches: fast enough for a few thousand devices within the time limit.
    for (let i = 0; i < deviceIds.length; i += 20) {
      await Promise.all(deviceIds.slice(i, i + 20).map((id) => handleDevice(id).catch((e) => console.error('[push] device error', e))));
    }

    return {
      ok: true,
      noticeCount: snapshot.notices.length,
      freshNotices: fresh.length,
      devices: deviceIds.length,
      sent,
      pruned,
      staleSources: snapshot.staleSources,
    };
  });

  return result ?? { ...empty, ok: true, skipped: 'another-run-in-progress' };
}
