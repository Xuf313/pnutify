import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { loginAndScrapePlato } from '@/lib/scrapePlato';

const redis = Redis.fromEnv();
const CREDS_KEY = 'plato:credentials';
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasRedisEnv = Boolean(redisUrl && redisToken);

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    const result = await loginAndScrapePlato(username, password);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });
    // Login worked — store the credentials so the cron job can check for new
    // PLATO announcements on its own, without the app being open.
    if (hasRedisEnv) {
      await redis.set(CREDS_KEY, { username, password }).catch(() => {});
    }
    return NextResponse.json({ classes: result.classes, announcements: result.announcements, tasks: result.tasks });
  } catch (error) {
    console.error('PLATO scraping error:', error);
    return NextResponse.json({ error: 'Failed to sync with PLATO. Network error.' }, { status: 500 });
  }
}

export async function DELETE() {
  if (hasRedisEnv) {
    await redis.del(CREDS_KEY).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}