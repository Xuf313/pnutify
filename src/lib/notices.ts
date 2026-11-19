import type { Redis } from '@upstash/redis';
import { getRedis, KEYS, withLock } from './redis';
import {
  checkFirstPages,
  fetchFullTitle,
  mayBeCutOff,
  scrapeAllBoards,
  sortNotices,
  type NoticeSource,
  type ScrapedNotice,
} from './scrapeNotices';

export type Notice = ScrapedNotice & {
  /** When PNUtify first saw this notice (epoch ms). Drives "New" badges and pushes. */
  firstSeenAt: number;
};

export type NoticeSnapshot = {
  /** Last time the boards were checked. A quick page-1 check counts. */
  updatedAt: number;
  /** Last full scrape of every page. */
  scrapedAt: number;
  notices: Notice[];
  /** Boards that failed on the last full scrape (their notices were kept from before). */
  staleSources: NoticeSource[];
  /** When each currently failing board started failing. */
  failingSince: Partial<Record<NoticeSource, number>>;
};

/** How old a snapshot may get before a page view refreshes it (only matters when no cron is running). */
export const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;
/** Even when page 1 shows nothing new, re-read every page this often (catches edits and removals). */
export const FULL_REFRESH_MS = 30 * 60 * 1000;
/** A board failing for this long is reported as down by the cron endpoint. */
export const BOARD_DOWN_ALERT_MS = 3 * 60 * 60 * 1000;
/** Article pages read per run to recover titles the board list cut off. */
const TITLE_LOOKUPS_PER_RUN = 12;
const FORGET_AFTER_MS = 200 * 86_400_000;

const EMPTY: NoticeSnapshot = { updatedAt: 0, scrapedAt: 0, notices: [], staleSources: [], failingSince: {} };

/** Fills fields that snapshots written by earlier versions don't have. */
function normalize(s: Partial<NoticeSnapshot>, checkedAt = 0): NoticeSnapshot {
  const updatedAt = Number(s.updatedAt) || 0;
  return {
    notices: Array.isArray(s.notices) ? s.notices : [],
    staleSources: Array.isArray(s.staleSources) ? s.staleSources : [],
    failingSince: s.failingSince && typeof s.failingSince === 'object' ? s.failingSince : {},
    scrapedAt: Number(s.scrapedAt) || updatedAt,
    updatedAt: Math.max(updatedAt, Number(checkedAt) || 0),
  };
}

export async function getSnapshot(): Promise<NoticeSnapshot | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const [snap, checkedAt] = await redis.mget<[Partial<NoticeSnapshot> | null, number | null]>(KEYS.latestNotices, KEYS.checkedAt);
    return snap ? normalize(snap, checkedAt ?? 0) : null;
  } catch {
    return null;
  }
}

export type RefreshResult = {
  snapshot: NoticeSnapshot;
  /** True when every page was re-read (so there may be new notices). */
  changed: boolean;
};

export type RefreshOptions = {
  /** Check page 1 first and skip the full scrape when nothing is new. */
  quick?: boolean;
  /** The caller already holds the run lock. */
  locked?: boolean;
};

/**
 * Brings the shared snapshot up to date. A board that fails keeps its previous
 * notices, so a flaky university server can't make notices disappear and then
 * come back as "new" (which used to cause duplicate pushes).
 */
export async function refreshNotices(now = Date.now(), opts: RefreshOptions = {}): Promise<RefreshResult> {
  const redis = getRedis();
  if (!redis) {
    // Local development without Redis: scrape on every call, remember full titles in memory.
    const results = await scrapeAllBoards(now);
    const scraped = results.flatMap((r) => r.notices);
    Object.assign(memoryTitles, await lookUpFullTitles(scraped, memoryTitles));
    const notices = sortNotices(
      scraped.map((n) => ({
        ...n,
        title: matchesListed(memoryTitles[n.id], n.title) ? memoryTitles[n.id] : n.title,
        firstSeenAt: n.postedAt ?? now,
      })),
    );
    const staleSources = results.filter((r) => !r.ok).map((r) => r.source);
    return { snapshot: { updatedAt: now, scrapedAt: now, notices, staleSources, failingSince: {} }, changed: true };
  }

  const run = () => refreshWithRedis(redis, now, opts.quick ?? false);
  if (opts.locked) return run();
  // Same lock as the cron run, so a page view and a cron call never scrape at once.
  const out = await withLock(redis, KEYS.runLock, 55, run);
  if (out) return out;
  return { snapshot: (await getSnapshot()) ?? EMPTY, changed: false };
}

async function refreshWithRedis(redis: Redis, now: number, quick: boolean): Promise<RefreshResult> {
  const previous = await getSnapshot();

  if (quick && previous && previous.notices.length > 0 && now - previous.scrapedAt < FULL_REFRESH_MS) {
    const pages = await checkFirstPages(now);
    const known = new Set(previous.notices.map((n) => n.id));
    const needFull = pages.some((p) => {
      const wasFailing = previous.failingSince[p.source] !== undefined;
      // A board that just failed, or just came back, needs a full pass to update its state.
      if (!p.ok) return !wasFailing;
      return wasFailing || p.ids.some((id) => !known.has(id));
    });
    if (!needFull) {
      await redis.set(KEYS.checkedAt, now);
      return { snapshot: { ...previous, updatedAt: now }, changed: false };
    }
  }

  return { snapshot: await fullRefresh(redis, now, previous), changed: true };
}

const memoryTitles: Record<string, string> = {};

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** A stored full title still belongs to a notice if it contains the listed (possibly cut) title. */
function matchesListed(full: string | undefined, listed: string): full is string {
  return typeof full === 'string' && full.length > 0 && squash(full).includes(squash(listed).slice(0, 30));
}

/**
 * The board list cuts long titles off. Reads the full title from the article
 * page for titles that may be cut and aren't known yet: newest first, a few per
 * run, 4 at a time. Returns id → full title for the lookups that worked.
 */
async function lookUpFullTitles(notices: ScrapedNotice[], known: Record<string, string>): Promise<Record<string, string>> {
  const lookups = sortNotices(notices.filter((n) => mayBeCutOff(n) && !matchesListed(known[n.id], n.title))).slice(
    0,
    TITLE_LOOKUPS_PER_RUN,
  );
  const found: Record<string, string> = {};
  for (let i = 0; i < lookups.length; i += 4) {
    const chunk = lookups.slice(i, i + 4);
    const titles = await Promise.all(chunk.map((n) => fetchFullTitle(n)));
    titles.forEach((t, j) => {
      if (t.ok) found[chunk[j].id] = t.title;
    });
  }
  return found;
}

async function fullRefresh(redis: Redis, now: number, previous: NoticeSnapshot | null): Promise<NoticeSnapshot> {
  const results = await scrapeAllBoards(now);
  const [firstSeenRaw, titlesRaw] = await Promise.all([
    redis.hgetall<Record<string, number>>(KEYS.firstSeen),
    redis.hgetall<Record<string, string>>(KEYS.fullTitles),
  ]);
  const firstSeen = (firstSeenRaw ?? {}) as Record<string, number>;
  const fullTitles = (titlesRaw ?? {}) as Record<string, string>;
  const isFirstRun = Object.keys(firstSeen).length === 0;

  const merged: ScrapedNotice[] = [];
  const staleSources: NoticeSource[] = [];
  const failingSince: Partial<Record<NoticeSource, number>> = {};
  for (const r of results) {
    if (r.ok && r.notices.length > 0) {
      merged.push(...r.notices);
    } else {
      staleSources.push(r.source);
      failingSince[r.source] = previous?.failingSince[r.source] ?? now;
      merged.push(...(previous?.notices.filter((n) => n.source === r.source) ?? []));
    }
  }

  const found = await lookUpFullTitles(merged, fullTitles);
  if (Object.keys(found).length > 0) {
    await redis.hset(KEYS.fullTitles, found);
    Object.assign(fullTitles, found);
  }

  const additions: Record<string, number> = {};
  const notices: Notice[] = merged.map((n) => {
    let seen = firstSeen[n.id];
    if (seen === undefined) {
      // On the very first run nothing is "new": date everything by its post date.
      seen = isFirstRun ? (n.postedAt ?? now) : now;
      additions[n.id] = seen;
    }
    const full = fullTitles[n.id];
    return { ...n, title: matchesListed(full, n.title) ? full : n.title, firstSeenAt: Number(seen) };
  });
  if (Object.keys(additions).length > 0) await redis.hset(KEYS.firstSeen, additions);

  // Forget notices that left the window long ago.
  const currentIds = new Set(notices.map((n) => n.id));
  const staleSeen = Object.entries(firstSeen)
    .filter(([id, t]) => !currentIds.has(id) && Number(t) < now - FORGET_AFTER_MS)
    .map(([id]) => id);
  if (staleSeen.length > 0) await redis.hdel(KEYS.firstSeen, ...staleSeen);
  const staleTitles = Object.keys(fullTitles).filter((id) => !currentIds.has(id));
  if (staleTitles.length > 0) await redis.hdel(KEYS.fullTitles, ...staleTitles);

  const snapshot: NoticeSnapshot = { updatedAt: now, scrapedAt: now, notices: sortNotices(notices), staleSources, failingSince };
  await Promise.all([redis.set(KEYS.latestNotices, snapshot), redis.set(KEYS.checkedAt, now)]);
  return snapshot;
}
