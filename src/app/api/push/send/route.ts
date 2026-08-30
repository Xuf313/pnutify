import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import webpush from 'web-push';
import type { PushSubscription } from 'web-push';
import { scrapeAllNotices } from '@/lib/scrapeNotices';

export const maxDuration = 60;

const redis = Redis.fromEnv();

const DEVICES_SET = 'push:devices';
// Notices are public, shared data — one seen-list for everyone, not per-device.
const SEEN_KEY = 'push:seen-ids';
const DEFAULT_CATEGORIES: Record<string, boolean> = { international: true, cse: true, tasks: true };

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasRedisEnv = Boolean(redisUrl && redisToken);

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const isPushSubscription = (value: unknown): value is PushSubscription =>
  typeof value === 'object' && value !== null && 'endpoint' in value;

async function sendPush(subscription: PushSubscription, payload: { title: string; body: string; url: string }) {
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

function isGoneError(err: unknown): boolean {
  const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err ? (err as { statusCode?: number }).statusCode : undefined;
  return statusCode === 404 || statusCode === 410 || statusCode === 403;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret') || request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!hasRedisEnv) {
    return NextResponse.json({ error: 'Redis not configured' }, { status: 500 });
  }

  const hasVapidKeys = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  if (hasVapidKeys) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:notices@example.com',
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
  }

  // ---- Scrape notices once for everyone — this is public data, not
  // personal, so there's no reason to re-scrape per device. ----
  let notices: any[] = [];
  let isFirstRun = false;
  let newNotices: any[] = [];
  try {
    notices = await Promise.race([
      scrapeAllNotices(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Scrape timed out after 20s')), 20000)),
    ]);
    const seenIdsArr = toStringArray(await redis.get<unknown>(SEEN_KEY));
    const seenIds = new Set(seenIdsArr);
    newNotices = notices.filter((n) => !seenIds.has(n.id));
    isFirstRun = seenIdsArr.length === 0;
    await redis.set(SEEN_KEY, notices.map((n) => n.id));
  } catch (err) {
    console.error('[push/send] scrape failed but continuing execution:', err);
  }

  const deviceIds = await redis.smembers(DEVICES_SET).catch(() => [] as string[]);
  let notifiedDevices = 0;
  let prunedDevices = 0;

  for (const deviceId of deviceIds) {
    try {
      const [subscription, storedCategories] = await Promise.all([
        redis.get<unknown>(`push:subscription:${deviceId}`),
        redis.get<Record<string, boolean>>(`push:categories:${deviceId}`),
      ]);
      if (!isPushSubscription(subscription)) {
        // Key expired (inactive 45+ days) or was never fully written —
        // either way, this device has nothing to push to. Drop it from the
        // set now instead of waiting on a failed push that may never come.
        await redis.srem(DEVICES_SET, deviceId);
        prunedDevices++;
        continue;
      }
      if (!hasVapidKeys) continue;
      const categories = { ...DEFAULT_CATEGORIES, ...(storedCategories || {}) };

      let devicePushed = false;
      let subscriptionGone = false;

      // ---- New notices, filtered by this device's own toggles — one push
      // per notice rather than batching into an "and N others" message ----
      const notifiableNotices = newNotices.filter((n) => categories[n.source]);
      if (!isFirstRun && notifiableNotices.length > 0) {
        for (const notice of notifiableNotices) {
          try {
            await sendPush(subscription as PushSubscription, { title: 'New PNU Notice', body: notice.title, url: notice.url || '/' });
            devicePushed = true;
          } catch (err) {
            console.error(`[push/send] notice push failed for ${deviceId}:`, err);
            if (isGoneError(err)) { subscriptionGone = true; break; }
          }
        }
      }

      // ---- This device's own task deadlines — same one-per-task treatment ----
      if (!subscriptionGone && categories.tasks) {
        const tasks = (await redis.get<any[]>(`tasks:list:${deviceId}`)) || [];
        const notifiedKey = `push:notified-deadlines:${deviceId}`;
        const notifiedDeadlines = new Set(toStringArray(await redis.get<unknown>(notifiedKey)));
        const now = Date.now();
        const REMINDER_WINDOW = 24 * 60 * 60 * 1000;
        const dueTasks = tasks.filter((t) => {
          const due = new Date(t.dueDate).getTime();
          return !isNaN(due) && due <= (now + REMINDER_WINDOW) && !notifiedDeadlines.has(String(t.id));
        });

        for (const task of dueTasks) {
          const dueTime = new Date(task.dueDate).getTime();
          const hoursLeft = Math.floor((dueTime - now) / (1000 * 60 * 60));
          const timeString = hoursLeft > 0 ? `in about ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}` : 'now (overdue)';
          const body = `Reminder: "${task.title}" is due ${timeString}.`;
          try {
            await sendPush(subscription as PushSubscription, { title: 'Upcoming Deadline', body, url: '/' });
            devicePushed = true;
            notifiedDeadlines.add(String(task.id));
            await redis.set(notifiedKey, [...notifiedDeadlines]);
          } catch (err) {
            console.error(`[push/send] deadline push failed for ${deviceId}:`, err);
            if (isGoneError(err)) { subscriptionGone = true; break; }
          }
        }
      }

      if (subscriptionGone) {
        await redis.del(`push:subscription:${deviceId}`);
        await redis.srem(DEVICES_SET, deviceId);
        prunedDevices++;
      } else if (devicePushed) {
        notifiedDevices++;
      }
    } catch (err) {
      console.error(`[push/send] device ${deviceId} failed:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    noticeCount: notices.length,
    newNoticeCount: isFirstRun ? 0 : newNotices.length,
    firstRun: isFirstRun,
    deviceCount: deviceIds.length,
    notifiedDevices,
    prunedDevices,
  });
}