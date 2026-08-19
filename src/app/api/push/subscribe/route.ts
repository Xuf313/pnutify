import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

// Single-user app — one fixed key is enough, no subscriptions table needed.
const SUB_KEY = 'push:subscription';

export async function POST(request: Request) {
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
  try {
    await redis.del(SUB_KEY);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 });
  }
}
