import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import webpush from 'web-push';
import { scrapeAllNotices } from '@/lib/scrapeNotices';

const redis = Redis.fromEnv();

const SUB_KEY = 'push:subscription';
const SEEN_KEY = 'push:seen-ids';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret') || request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasVapidKeys = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

  try {
    const notices = await scrapeAllNotices();
    const seenIdsArr = (await redis.get<string[]>(SEEN_KEY)) || [];
    const seenIds = new Set(seenIdsArr);
    const newNotices = notices.filter((n) => !seenIds.has(n.id));

    // Don't notify on the very first run — that would fire once per existing
    // notice just because there's no prior baseline yet.
    const isFirstRun = seenIdsArr.length === 0;

    if (!isFirstRun && newNotices.length > 0) {
      const subscription = await redis.get<any>(SUB_KEY);
      if (subscription && hasVapidKeys) {
        webpush.setVapidDetails(
          process.env.VAPID_SUBJECT || 'mailto:notices@example.com',
          process.env.VAPID_PUBLIC_KEY!,
          process.env.VAPID_PRIVATE_KEY!
        );
        const body =
          newNotices.length === 1
            ? newNotices[0].title
            : `${newNotices.length} new notices — including "${newNotices[0].title}"`;

        try {
          await webpush.sendNotification(
            subscription,
            JSON.stringify({ title: 'New PNU Notice', body, url: newNotices[0].url || '/' })
          );
        } catch (err: any) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await redis.del(SUB_KEY);
          }
        }
      }
    }

    await redis.set(SEEN_KEY, notices.map((n) => n.id));
    return NextResponse.json({ ok: true, newCount: isFirstRun ? 0 : newNotices.length, firstRun: isFirstRun });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to check notices' }, { status: 500 });
  }
}
