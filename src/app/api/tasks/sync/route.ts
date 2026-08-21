import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const TASKS_KEY = 'tasks:list';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasRedisEnv = Boolean(redisUrl && redisToken);

// Tasks otherwise only live in the browser's localStorage — the cron job
// (which runs with no browser open) needs its own copy server-side to be
// able to check deadlines at all. Only unfinished, user-created tasks matter
// for deadline pings, so that's all this stores.
export async function POST(request: Request) {
  if (!hasRedisEnv) return NextResponse.json({ ok: false, error: 'Redis not configured' });
  try {
    const body = await request.json();
    const tasks = Array.isArray(body?.tasks) ? body.tasks : [];
    const relevant = tasks
      .filter((t: any) => t && t.source === 'own' && t.status !== 'completed' && t.dueDate)
      .map((t: any) => ({ id: t.id, title: t.title, course: t.course, dueDate: t.dueDate }));
    await redis.set(TASKS_KEY, relevant);
    return NextResponse.json({ ok: true, count: relevant.length });
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to sync tasks' }, { status: 500 });
  }
}
