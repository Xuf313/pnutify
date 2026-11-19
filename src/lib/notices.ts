import { getRedis, KEYS, withLock } from './redis';
import { scrapeAllBoards, sortNotices, type NoticeSource, type ScrapedNotice } from './scrapeNotices';

export type Notice = ScrapedNotice & {
  /** When PNUtify first saw this notice (epoch ms). Drives "New" badges and pushes. */
  firstSeenAt: number;
};

export type NoticeSnapshot = {
  updatedAt: number;
  notices: Notice[];
  /** Boards that failed on the last refresh (their notices were kept from before). */
  staleSources: NoticeSource[];
};

/** How old a cached snapshot may get before a page view triggers a refresh. */
export const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

export async function getSnapshot(): Promise<NoticeSnapshot | null> {
  const redis = getRedis();
  if (!redis) return null;
  return (await redis.get<NoticeSnapshot>(KEYS.latestNotices).catch(() => null)) ?? null;
}

/**
 * Scrape both boards and store one shared snapshot. A board that fails keeps
 * its previous notices, so a flaky university server can't make notices
 * disappear and then come back as "new" (which used to cause duplicate pushes).
 */
export async function refreshNotices(now = Date.now()): Promise<NoticeSnapshot> {
  const redis = getRedis();
  const results = await scrapeAllBoards(now);

  if (!redis) {
    const notices = sortNotices(results.flatMap((r) => r.notices).map((n) => ({ ...n, firstSeenAt: n.postedAt ?? now })));
    return { updatedAt: now, notices, staleSources: results.filter((r) => !r.ok).map((r) => r.source) };
  }

  const run = async (): Promise<NoticeSnapshot> => {
    const previous = await getSnapshot();
    const firstSeen = ((await redis.hgetall<Record<string, number>>(KEYS.firstSeen)) ?? {}) as Record<string, number>;
    const isFirstRun = Object.keys(firstSeen).length === 0;

    const merged: ScrapedNotice[] = [];
    const staleSources: NoticeSource[] = [];
    for (const r of results) {
      if (r.ok && r.notices.length > 0) merged.push(...r.notices);
      else {
        staleSources.push(r.source);
        merged.push(...(previous?.notices.filter((n) => n.source === r.source) ?? []));
      }
    }

    const additions: Record<string, number> = {};
    const notices: Notice[] = merged.map((n) => {
      let seen = firstSeen[n.id];
      if (seen === undefined) {
        // On the very first run nothing is "new": date everything by its post date.
        seen = isFirstRun ? (n.postedAt ?? now) : now;
        additions[n.id] = seen;
      }
      return { ...n, firstSeenAt: Number(seen) };
    });

    if (Object.keys(additions).length > 0) await redis.hset(KEYS.firstSeen, additions);

    // Forget first-seen times for notices that left the window long ago.
    const currentIds = new Set(notices.map((n) => n.id));
    const stale = Object.entries(firstSeen)
      .filter(([id, t]) => !currentIds.has(id) && Number(t) < now - 200 * 86_400_000)
      .map(([id]) => id);
    if (stale.length > 0) await redis.hdel(KEYS.firstSeen, ...stale);

    const snapshot: NoticeSnapshot = { updatedAt: now, notices: sortNotices(notices), staleSources };
    await redis.set(KEYS.latestNotices, snapshot);
    return snapshot;
  };

  const out = await withLock(redis, KEYS.refreshLock, 90, run);
  if (out) return out;
  // Someone else is refreshing right now; serve what we have.
  return (await getSnapshot()) ?? { updatedAt: 0, notices: [], staleSources: [] };
}
