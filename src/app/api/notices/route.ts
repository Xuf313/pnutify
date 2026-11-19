import { NextResponse } from 'next/server';
import { getSnapshot, refreshNotices, SNAPSHOT_MAX_AGE_MS } from '@/lib/notices';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Serves the shared snapshot the cron keeps fresh, so a page view never has
 * to scrape the university sites itself. Only when the snapshot is missing or
 * old (cron not set up yet) does a request refresh it.
 */
export async function GET() {
  try {
    let snapshot = await getSnapshot();
    if (!snapshot || Date.now() - snapshot.updatedAt > SNAPSHOT_MAX_AGE_MS) {
      snapshot = await refreshNotices();
    }
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('[notices] failed', error);
    return NextResponse.json({ error: 'Failed to fetch notices' }, { status: 500 });
  }
}
