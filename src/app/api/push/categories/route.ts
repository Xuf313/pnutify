import { NextResponse } from 'next/server';
import { DEVICE_TTL_SECONDS, getRedis, isValidDeviceId, KEYS } from '@/lib/redis';
import { DEFAULT_CATEGORIES, normalizeCategories } from '@/lib/push';
import { recordDemand } from '@/lib/notices';
import { isKnownBoard } from '@/lib/boardList';

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

/** Body: { deviceId, categories: { boards?, tasks?, weekly?, courses? } } — only the given keys change; `boards` replaces the list. */
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
    // Clients from before the board list send one switch per board ({ cse: true }).
    let boards = Array.isArray(patch.boards) ? patch.boards : current.boards;
    for (const [key, on] of Object.entries(patch)) {
      if (!isKnownBoard(key) || typeof on !== 'boolean') continue;
      boards = on ? [...boards, key] : boards.filter((b) => b !== key);
    }
    const updated = normalizeCategories({ ...current, ...patch, boards });
    await redis.set(KEYS.categories(deviceId), updated, { ex: DEVICE_TTL_SECONDS });
    // A board that just got alerts goes on the checking schedule now, not at the next deadline check.
    await recordDemand(updated.boards, 'alert');
    return NextResponse.json({ categories: updated });
  } catch {
    return NextResponse.json({ error: 'Failed to update categories' }, { status: 500 });
  }
}
