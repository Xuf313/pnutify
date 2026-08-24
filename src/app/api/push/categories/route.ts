import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const DEFAULT_CATEGORIES: Record<string, boolean> = { international: true, cse: true, tasks: true };
const DEVICE_TTL_SECONDS = 45 * 24 * 60 * 60;

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasRedisEnv = Boolean(redisUrl && redisToken);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get('deviceId');
  if (!deviceId || !hasRedisEnv) return NextResponse.json({ categories: DEFAULT_CATEGORIES });
  try {
    const stored = (await redis.get<Record<string, boolean>>(`push:categories:${deviceId}`)) || {};
    // This fires whenever the notices/tasks tab renders — a natural "app is
    // still being used" signal, so piggyback the TTL refresh here too.
    await redis.expire(`push:subscription:${deviceId}`, DEVICE_TTL_SECONDS).catch(() => {});
    await redis.expire(`push:categories:${deviceId}`, DEVICE_TTL_SECONDS).catch(() => {});
    return NextResponse.json({ categories: { ...DEFAULT_CATEGORIES, ...stored } });
  } catch {
    return NextResponse.json({ categories: DEFAULT_CATEGORIES });
  }
}

export async function POST(request: Request) {
  if (!hasRedisEnv) return NextResponse.json({ error: 'Redis not configured' }, { status: 500 });
  try {
    const body = await request.json();
    const { deviceId, category, enabled } = body || {};
    if (!deviceId || typeof category !== 'string' || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    const stored = (await redis.get<Record<string, boolean>>(`push:categories:${deviceId}`)) || {};
    const updated = { ...DEFAULT_CATEGORIES, ...stored, [category]: enabled };
    await redis.set(`push:categories:${deviceId}`, updated, { ex: DEVICE_TTL_SECONDS });
    return NextResponse.json({ categories: updated });
  } catch {
    return NextResponse.json({ error: 'Failed to update categories' }, { status: 500 });
  }
}