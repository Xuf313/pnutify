import { NextResponse } from 'next/server';
import webpush, { type PushSubscription } from 'web-push';
import { getRedis, isValidDeviceId, KEYS } from '@/lib/redis';

/** Sends one test notification to the caller's own device (max once a minute). */
export async function POST(request: Request) {
  const redis = getRedis();
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!redis || !pub || !priv) return NextResponse.json({ error: 'Notifications are not configured' }, { status: 503 });
  const { deviceId } = (await request.json().catch(() => ({}))) ?? {};
  if (!isValidDeviceId(deviceId)) return NextResponse.json({ error: 'Invalid device' }, { status: 400 });

  const allowed = await redis.set(`push:test-limit:${deviceId}`, 1, { nx: true, ex: 60 });
  if (allowed !== 'OK') return NextResponse.json({ error: 'Try again in a minute' }, { status: 429 });

  const sub = await redis.get<PushSubscription>(KEYS.subscription(deviceId));
  if (!sub) return NextResponse.json({ error: 'This device is not subscribed' }, { status: 404 });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://www.pnutify.app', pub, priv);
  try {
    await webpush.sendNotification(
      sub,
      JSON.stringify({ title: 'PNUtify alerts are working', body: "You'll get new notices and deadline reminders here.", url: '/', tag: 'test' }),
      { TTL: 600 },
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Push service rejected the message' }, { status: 502 });
  }
}
