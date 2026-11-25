import { NextResponse, type NextRequest } from 'next/server';
import { combine, readBoards, readMeta, recordDemand, refreshNotices, SNAPSHOT_MAX_AGE_MS } from '@/lib/notices';
import { DEFAULT_BOARD_IDS, boardDef, isKnownBoard } from '@/lib/boardList';
import { getRedis } from '@/lib/redis';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_BOARDS = 12;
/** Boards a page view may read itself when they've never been read (the cron picks up the rest within a minute). */
const MAX_INLINE_READS = 3;

/** `?boards=cse,math,international`; unknown ids are ignored, and no list means the default (International). */
function requestedBoards(req: NextRequest): string[] {
  const raw = req.nextUrl.searchParams.get('boards');
  if (raw === null) return DEFAULT_BOARD_IDS;
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(isKnownBoard))].slice(0, MAX_BOARDS);
}

/**
 * Serves the boards the app shows, from the copies the cron keeps fresh, so a
 * page view almost never has to read the university sites itself. Asking for
 * a department board also puts it on the cron's schedule for a while.
 */
export async function GET(req: NextRequest) {
  try {
    const ids = requestedBoards(req);
    const now = Date.now();
    const redis = getRedis();
    if (!redis) {
      const { snapshot } = await refreshNotices(now, { boards: ids });
      return NextResponse.json({ ...snapshot, boards: ids, pending: [] });
    }

    const departments = ids.filter((id) => !boardDef(id)?.core);
    const [snapshots, metas] = await Promise.all([readBoards(redis, ids), readMeta(redis), recordDemand(departments, 'view', now)]);
    const have = new Set(snapshots.map((s) => s.board));
    // Never read, or (only when no cron is running) a core board gone stale.
    const missing = ids.filter((id) => !have.has(id));
    const staleCore = ids.filter((id) => have.has(id) && boardDef(id)?.core && now - (metas[id]?.checkedAt ?? 0) > SNAPSHOT_MAX_AGE_MS);
    const toRead = [...missing.slice(0, MAX_INLINE_READS), ...staleCore];

    let all = snapshots;
    let allMetas = metas;
    if (toRead.length > 0) {
      await refreshNotices(now, { boards: toRead });
      [all, allMetas] = await Promise.all([readBoards(redis, ids), readMeta(redis)]);
    }
    const got = new Set(all.map((s) => s.board));
    return NextResponse.json(
      { ...combine(all, allMetas), boards: ids, pending: ids.filter((id) => !got.has(id)) },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } },
    );
  } catch (error) {
    console.error('[notices] failed', error);
    return NextResponse.json({ error: 'Failed to fetch notices' }, { status: 500 });
  }
}
