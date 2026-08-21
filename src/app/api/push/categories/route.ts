import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const CATEGORIES_KEY = 'push:categories';
const DEFAULT_CATEGORIES: Record<string, boolean> = { international: true, cse: true, classes: true, tasks: true };

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasRedisEnv = Boolean(redisUrl && redisToken);

export async function GET() {
  if (!hasRedisEnv) return NextResponse.json({ categories: DEFAULT_CATEGORIES });
  try {
    const stored = (await redis.get<Record<string, boolean>>(CATEGORIES_KEY)) || {};
    return NextResponse.json({ categories: { ...DEFAULT_CATEGORIES, ...stored } });
  } catch {
    return NextResponse.json({ categories: DEFAULT_CATEGORIES });
  }
}

export async function POST(request: Request) {
  if (!hasRedisEnv) return NextResponse.json({ error: 'Redis not configured' }, { status: 500 });
  try {
    const body = await request.json();
    const { category, enabled } = body || {};
    if (typeof category !== 'string' || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    const stored = (await redis.get<Record<string, boolean>>(CATEGORIES_KEY)) || {};
    const updated = { ...DEFAULT_CATEGORIES, ...stored, [category]: enabled };
    await redis.set(CATEGORIES_KEY, updated);
    return NextResponse.json({ categories: updated });
  } catch {
    return NextResponse.json({ error: 'Failed to update categories' }, { status: 500 });
  }
}