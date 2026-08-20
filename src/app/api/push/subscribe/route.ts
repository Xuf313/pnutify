import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

// Single-user app — one fixed key is enough, no subscriptions table needed.
const SUB_KEY = 'push:subscription';

export async function POST(request: Request) {
  if (!redis) {
    return NextResponse.json({ error: 'Push storage is not configured' }, { status: 503 });
  }

  try {
    const subscription = await request.json();
    if (!subscription?.endpoint) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }
    await redis.set(SUB_KEY, subscription);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }
}

export async function DELETE() {
  if (!redis) {
    return NextResponse.json({ error: 'Push storage is not configured' }, { status: 503 });
  }

  try {
    await redis.del(SUB_KEY);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 });
  }
}
