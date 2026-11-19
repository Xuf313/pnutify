import { NextResponse } from 'next/server';
import { DEVICE_TTL_SECONDS, getRedis, isValidDeviceId, KEYS } from '@/lib/redis';

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };

function isSubscription(v: unknown): v is Sub {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<Sub>;
  return (
    typeof s.endpoint === 'string' &&
    s.endpoint.startsWith('https://') &&
    s.endpoint.length < 1000 &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string'
  );
}

/** Saves (or refreshes) this browser's push subscription. Called on every app open while alerts are on. */
export async function POST(request: Request) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Notifications are not configured on this server' }, { status: 503 });
  try {
    const body = await request.json();
    const { deviceId, subscription } = body ?? {};
    if (!isValidDeviceId(deviceId) || !isSubscription(subscription)) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }
    const clean: Sub = { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
    await Promise.all([
      redis.set(KEYS.subscription(deviceId), clean, { ex: DEVICE_TTL_SECONDS }),
      redis.sadd(KEYS.devices, deviceId),
      redis.expire(KEYS.categories(deviceId), DEVICE_TTL_SECONDS),
      redis.expire(KEYS.tasks(deviceId), DEVICE_TTL_SECONDS),
    ]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const redis = getRedis();
  const deviceId = new URL(request.url).searchParams.get('deviceId');
  if (!redis || !isValidDeviceId(deviceId)) return NextResponse.json({ ok: true });
  await Promise.all([
    redis.del(KEYS.subscription(deviceId)),
    redis.del(KEYS.categories(deviceId)),
    redis.del(KEYS.tasks(deviceId)),
    redis.del(KEYS.notifiedDeadlines(deviceId)),
    redis.srem(KEYS.devices, deviceId),
  ]).catch(() => {});
  return NextResponse.json({ ok: true });
}
