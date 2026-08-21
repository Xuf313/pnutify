import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import webpush from 'web-push';
import type { PushSubscription } from 'web-push';
import { scrapeAllNotices } from '@/lib/scrapeNotices';
import { loginAndScrapePlato } from '@/lib/scrapePlato';

export const maxDuration = 60;

const redis = Redis.fromEnv();

const SUB_KEY = 'push:subscription';
const SEEN_KEY = 'push:seen-ids';
const CATEGORIES_KEY = 'push:categories';
const TASKS_KEY = 'tasks:list';
const NOTIFIED_DEADLINES_KEY = 'push:notified-deadlines';
const PLATO_CREDS_KEY = 'plato:credentials';
const PLATO_SEEN_KEY = 'push:plato-seen-ids';
const DEFAULT_CATEGORIES: Record<string, boolean> = { international: true, cse: true, classes: true, tasks: true };

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret') || request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasVapidKeys = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  if (hasVapidKeys) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:notices@example.com',
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
  }

  let notices;
  try {
    notices = await Promise.race([
      scrapeAllNotices(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Scrape timed out after 20s')), 20000)),
    ]);
  } catch (err) {
    console.error('[push/send] scrape failed:', err);
    return NextResponse.json({ error: 'Scrape failed', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  try {
    const categories = hasRedisEnv
      ? { ...DEFAULT_CATEGORIES, ...((await redis.get<Record<string, boolean>>(CATEGORIES_KEY)) || {}) }
      : DEFAULT_CATEGORIES;

    const subscription = hasRedisEnv ? await redis.get<unknown>(SUB_KEY) : null;
    const canPush = isPushSubscription(subscription) && hasVapidKeys;

    // ---- New notices (CSE / International) ----
    const seenIdsArr = hasRedisEnv ? toStringArray(await redis.get<unknown>(SEEN_KEY)) : [];
    const seenIds = new Set(seenIdsArr);
    const newNotices = notices.filter((n) => !seenIds.has(n.id));
    const isFirstRun = seenIdsArr.length === 0;
    const notifiableNotices = newNotices.filter((n) => categories[n.source]);

    if (!isFirstRun && notifiableNotices.length > 0 && canPush) {
      const body =
        notifiableNotices.length === 1
          ? notifiableNotices[0].title
          : `${notifiableNotices.length} new notices — including "${notifiableNotices[0].title}"`;
      try {
        await sendPush(subscription as PushSubscription, { title: 'New PNU Notice', body, url: notifiableNotices[0].url || '/' });
      } catch (err: unknown) {
        const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err ? (err as { statusCode?: number }).statusCode : undefined;
        console.error('[push/send] notice push failed:', err);
        if (statusCode === 404 || statusCode === 410) await redis.del(SUB_KEY);
      }
    }
    if (hasRedisEnv) await redis.set(SEEN_KEY, notices.map((n) => n.id));

    // ---- Task deadlines ----
    let dueCount = 0;
    if (hasRedisEnv && categories.tasks) {
      const tasks = (await redis.get<any[]>(TASKS_KEY)) || [];
      const notifiedDeadlines = new Set(toStringArray(await redis.get<unknown>(NOTIFIED_DEADLINES_KEY)));
      const now = Date.now();
      const dueTasks = tasks.filter((t) => {
        const due = new Date(t.dueDate).getTime();
        return !isNaN(due) && due <= now && !notifiedDeadlines.has(String(t.id));
      });
      dueCount = dueTasks.length;

      if (dueTasks.length > 0 && canPush) {
        const body =
          dueTasks.length === 1
            ? `"${dueTasks[0].title}" is due now`
            : `${dueTasks.length} tasks are due — including "${dueTasks[0].title}"`;
        try {
          await sendPush(subscription as PushSubscription, { title: 'Task Deadline', body, url: '/' });
        } catch (err: unknown) {
          const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err ? (err as { statusCode?: number }).statusCode : undefined;
          console.error('[push/send] deadline push failed:', err);
          if (statusCode === 404 || statusCode === 410) await redis.del(SUB_KEY);
        }
      }
      if (dueTasks.length > 0) {
        dueTasks.forEach((t) => notifiedDeadlines.add(String(t.id)));
        await redis.set(NOTIFIED_DEADLINES_KEY, [...notifiedDeadlines]);
      }
    }

    // ---- PLATO announcements (needs a login session, so only runs if
    // credentials were saved server-side and this toggle is on) ----
    let platoNewCount = 0;
    if (hasRedisEnv && categories.classes) {
      try {
        const creds = await redis.get<{ username: string; password: string }>(PLATO_CREDS_KEY);
        if (creds?.username && creds?.password) {
          const platoResult = await Promise.race([
            loginAndScrapePlato(creds.username, creds.password),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PLATO login timed out after 20s')), 20000)),
          ]);
          if (platoResult.ok) {
            const platoSeenArr = toStringArray(await redis.get<unknown>(PLATO_SEEN_KEY));
            const platoSeen = new Set(platoSeenArr);
            const newPlato = platoResult.announcements.filter((a: any) => !platoSeen.has(a.id));
            const isPlatoFirstRun = platoSeenArr.length === 0;
            platoNewCount = isPlatoFirstRun ? 0 : newPlato.length;

            if (!isPlatoFirstRun && newPlato.length > 0 && canPush) {
              const body =
                newPlato.length === 1
                  ? newPlato[0].title
                  : `${newPlato.length} new PLATO announcements — including "${newPlato[0].title}"`;
              try {
                await sendPush(subscription as PushSubscription, { title: 'New PLATO Announcement', body, url: newPlato[0].url || '/' });
              } catch (err: unknown) {
                const statusCode = typeof err === 'object' && err !== null && 'statusCode' in err ? (err as { statusCode?: number }).statusCode : undefined;
                console.error('[push/send] plato push failed:', err);
                if (statusCode === 404 || statusCode === 410) await redis.del(SUB_KEY);
              }
            }
            await redis.set(PLATO_SEEN_KEY, platoResult.announcements.map((a: any) => a.id));
          } else {
            console.error('[push/send] plato login failed:', platoResult.error);
          }
        }
      } catch (err) {
        console.error('[push/send] plato check failed:', err);
      }
    }

    return NextResponse.json({
      ok: true,
      noticeCount: notices.length,
      newCount: isFirstRun ? 0 : notifiableNotices.length,
      firstRun: isFirstRun,
      dueTaskCount: dueCount,
      platoNewCount,
      categories,
    });
  } catch (err) {
    console.error('[push/send] redis/push stage failed:', err);
    return NextResponse.json({ error: 'Redis or push stage failed', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}