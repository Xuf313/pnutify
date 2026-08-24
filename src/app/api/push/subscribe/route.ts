import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const DEVICES_SET = 'push:devices';
// A device that hasn't refreshed this in 45 days is treated as inactive and
// let the key expire naturally, rather than keeping every device forever.
const DEVICE_TTL_SECONDS = 45 * 24 * 60 * 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const deviceId = body?.deviceId;
    const subscription = body?.subscription;
    if (!deviceId || !subscription?.endpoint) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }
    await redis.set(`push:subscription:${deviceId}`, subscription, { ex: DEVICE_TTL_SECONDS });
    await redis.sadd(DEVICES_SET, deviceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('deviceId');
    if (deviceId) {
      await redis.del(`push:subscription:${deviceId}`);
      await redis.srem(DEVICES_SET, deviceId);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 });
  }
}