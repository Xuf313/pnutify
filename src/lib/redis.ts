import { Redis } from '@upstash/redis';

let client: Redis | null | undefined;

/**
 * Shared Upstash client, or null when Redis isn't configured (local dev).
 * Accepts both the Upstash names and the Vercel KV names for the same values.
 */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

/** Test seam: swap in an in-memory client. */
export function setRedisForTesting(fake: Redis | null): void {
  client = fake;
}

/** Best-effort mutex so two overlapping cron runs can't double-send. */
export async function withLock<T>(redis: Redis, key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T | null> {
  const token = Math.random().toString(36).slice(2);
  const got = await redis.set(key, token, { nx: true, ex: ttlSeconds });
  if (got !== 'OK') return null;
  try {
    return await fn();
  } finally {
    // Delete only our own lock (it may have expired and been taken by another run), in one call.
    await redis.eval(RELEASE_LOCK, [key], [token]).catch(() => {});
  }
}

export const RELEASE_LOCK = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export const DEVICE_TTL_SECONDS = 45 * 24 * 60 * 60;

export const KEYS = {
  devices: 'push:devices',
  subscription: (id: string) => `push:subscription:${id}`,
  categories: (id: string) => `push:categories:${id}`,
  tasks: (id: string) => `tasks:list:${id}`,
  notifiedDeadlines: (id: string) => `push:notified-deadlines:${id}`,
  latestNotices: 'notices:latest',
  checkedAt: 'notices:checked-at',
  firstSeen: 'notices:first-seen',
  fullTitles: 'notices:full-titles',
  deadlinesCheckedAt: 'push:deadlines-checked-at',
  pushedNotices: 'push:pushed-notice-ids',
  legacySeen: 'push:seen-ids',
  runLock: 'lock:push-run',
} as const;

/** Device ids come from the browser; keep them to a safe, bounded shape. */
export function isValidDeviceId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(id);
}
