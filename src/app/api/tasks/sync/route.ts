import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const DEVICE_TTL_SECONDS = 45 * 24 * 60 * 60;
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasRedisEnv = Boolean(redisUrl && redisToken);

// Tasks otherwise only live in the browser's localStorage — the cron job
// (which runs with no browser open) needs its own copy server-side to be
// able to check deadlines at all. Only unfinished, user-created tasks matter
// for deadline pings, so that's all this stores. Keyed per device so one
// person's tasks don't overwrite another's, and TTL'd so an inactive
// device's data doesn't linger forever.
export async function POST(request: Request) {
  if (!hasRedisEnv) return NextResponse.json({ ok: false, error: 'Redis not configured' });
  try {
    const body = await request.json();
    const deviceId = body?.deviceId;
    const tasks = Array.isArray(body?.tasks) ? body.tasks : [];
    if (!deviceId) return NextResponse.json({ ok: false, error: 'Missing deviceId' }, { status: 400 });
    const relevant = tasks
      .filter((t: any) => t && t.source === 'own' && t.status !== 'completed' && t.dueDate)
      .map((t: any) => ({ id: t.id, title: t.title, course: t.course, dueDate: t.dueDate }));
    await redis.set(`tasks:list:${deviceId}`, relevant, { ex: DEVICE_TTL_SECONDS });
    return NextResponse.json({ ok: true, count: relevant.length });
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to sync tasks' }, { status: 500 });
  }
}