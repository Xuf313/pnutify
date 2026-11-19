import { NextResponse } from 'next/server';
import { DEVICE_TTL_SECONDS, getRedis, isValidDeviceId, KEYS } from '@/lib/redis';
import { DEFAULT_CATEGORIES, normalizeCategories } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const redis = getRedis();
  const deviceId = new URL(request.url).searchParams.get('deviceId');
  if (!redis || !isValidDeviceId(deviceId)) return NextResponse.json({ categories: DEFAULT_CATEGORIES, subscribed: false });
  try {
    const [stored, sub] = await Promise.all([
      redis.get<unknown>(KEYS.categories(deviceId)),
      redis.exists(KEYS.subscription(deviceId)),
    ]);
    return NextResponse.json({ categories: normalizeCategories(stored), subscribed: sub === 1 });
  } catch {
    return NextResponse.json({ categories: DEFAULT_CATEGORIES, subscribed: false });
  }
}

/** Body: { deviceId, categories: { cse?, international?, tasks? } } — only the given keys change. */
export async function POST(request: Request) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'Notifications are not configured on this server' }, { status: 503 });
  try {
    const body = await request.json();
    const { deviceId } = body ?? {};
    if (!isValidDeviceId(deviceId)) return NextResponse.json({ error: 'Invalid device' }, { status: 400 });
    // Older clients send { category, enabled }.
    const patch: Record<string, unknown> =
      body.categories && typeof body.categories === 'object'
        ? body.categories
        : typeof body.category === 'string'
          ? { [body.category]: body.enabled }
          : {};
    const current = normalizeCategories(await redis.get<unknown>(KEYS.categories(deviceId)));
    const updated = normalizeCategories({ ...current, ...patch });
    await redis.set(KEYS.categories(deviceId), updated, { ex: DEVICE_TTL_SECONDS });
    return NextResponse.json({ categories: updated });
  } catch {
    return NextResponse.json({ error: 'Failed to update categories' }, { status: 500 });
  }
}
