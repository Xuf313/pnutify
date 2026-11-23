import type { Redis } from '@upstash/redis';
import { getRedis, KEYS, withLock } from './redis';
import {
  BOARDS,
  boardBySource,
  fetchFullTitle,
  mayBeCutOff,
  scrapeBoard,
  scrapeFirstPage,
  sortNotices,
  withoutCutMarker,
  type Board,
  type ScrapedNotice,
} from './scrapeNotices';

/**
 * Notices, one board at a time.
 *
 * Each board has its own stored copy (`notices:board:<id>`) and a small entry
 * in one shared hash (`notices:meta`: when it was checked and which notices it
 * had). The cron reads only that hash each minute and decides which boards to
 * look at: core boards (CSE, International) every run, department boards only
 * while someone shows them or has alerts on for them, and quiet ones less often.
 */

export type Notice = ScrapedNotice & {
  /** When PNUtify first saw this notice (epoch ms). Drives "New" badges and pushes. */
  firstSeenAt: number;
};

export type BoardSnapshot = {
  board: string;
  /** Last full read of the board. */
  scrapedAt: number;
  /** When the board started failing, or null while it reads fine. */
  failingSince: number | null;
  notices: Notice[];
};

export type BoardMeta = {
  /** Last check of any kind (a page-1 check counts). */
  checkedAt: number;
  scrapedAt: number;
  failingSince: number | null;
  /** Ids in the stored copy, so a page-1 check can tell whether anything is new. */
  ids: string[];
};

/** Several boards together, as the app and the alert cycle see them. */
export type NoticeSnapshot = {
  updatedAt: number;
  scrapedAt: number;
  notices: Notice[];
  /** Boards that failed on their last read (their notices were kept from before). */
  staleSources: string[];
  failingSince: Record<string, number>;
};

/** How old a core board may get before a page view refreshes it (only matters when no cron is running). */
export const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;
/** Re-read every page this often even when page 1 shows nothing new (catches edits and removals). */
export const CORE_FULL_MS = 30 * 60 * 1000;
export const DEPT_FULL_MS = 60 * 60 * 1000;
/** Page-1 checks for department boards: often when someone has alerts on, less when they're only viewed. */
export const ALERTED_QUICK_MS = 5 * 60 * 1000;
export const VIEWED_QUICK_MS = 15 * 60 * 1000;
/** A department board stays "in use" this long after someone last opened the app with it shown. */
export const VIEW_DEMAND_MS = 14 * 86_400_000;
/** Alert demand is refreshed every ~5 minutes by the deadline check; this covers a missed run or two. */
export const ALERT_DEMAND_MS = 60 * 60 * 1000;
/** Department boards per run, so a burst of demand never turns into a burst of requests. */
export const MAX_DEPT_QUICK = 8;
export const MAX_DEPT_FULL = 3;
/** A board failing for this long is reported as down by the cron endpoint. */
export const BOARD_DOWN_ALERT_MS = 3 * 60 * 60 * 1000;
/** Article pages read per board read to recover titles the list cut off. */
const TITLE_LOOKUPS_PER_READ = 12;
const FORGET_AFTER_MS = 200 * 86_400_000;

export const NOTICE_KEYS = {
  board: (id: string) => `notices:board:${id}`,
  meta: 'notices:meta',
  firstSeen: (id: string) => `notices:first-seen:${id}`,
  fullTitles: (id: string) => `notices:full-titles:${id}`,
  demand: 'boards:demand',
} as const;

// ---------- demand: which department boards anyone uses ----------

/** Records that these boards are shown (page views) or have alerts on (deadline checks). */
export async function recordDemand(boards: string[], kind: 'view' | 'alert', now = Date.now()): Promise<void> {
  const redis = getRedis();
  const ids = [...new Set(boards)].filter((b) => boardBySource(b) && !boardBySource(b)!.core);
  if (!redis || ids.length === 0) return;
  const [first, ...rest] = ids.map((id) => ({ score: now, member: `${kind}:${id}` }));
  await redis.zadd(NOTICE_KEYS.demand, first, ...rest).catch(() => null);
}

/** Department boards in use: "alert" if someone has alerts on, otherwise "view". */
export async function readDemand(redis: Redis, now: number): Promise<Map<string, 'alert' | 'view'>> {
  const raw = (await redis.zrange(NOTICE_KEYS.demand, now - VIEW_DEMAND_MS, '+inf', { byScore: true, withScores: true }).catch(() => [])) as (string | number)[];
  const demand = new Map<string, 'alert' | 'view'>();
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const [kind, id] = String(raw[i]).split(/:(.+)/);
    const score = Number(raw[i + 1]);
    if (kind === 'alert' && now - score <= ALERT_DEMAND_MS) demand.set(id, 'alert');
    else if (kind === 'view' && !demand.has(id)) demand.set(id, 'view');
  }
  return demand;
}

export async function readMeta(redis: Redis): Promise<Record<string, BoardMeta>> {
  return ((await redis.hgetall<Record<string, BoardMeta>>(NOTICE_KEYS.meta).catch(() => null)) ?? {}) as Record<string, BoardMeta>;
}

export type CheckPlan = { quick: string[]; full: string[] };

/** Which boards to look at this run, and how. Pure, so the schedule is easy to test. */
export function planChecks(now: number, metas: Record<string, BoardMeta>, demand: Map<string, 'alert' | 'view'>): CheckPlan {
  const quick: string[] = [];
  const full: string[] = [];
  const deptQuick: [string, number][] = [];
  const deptFull: [string, number][] = [];
  for (const b of BOARDS) {
    const kind = b.core ? 'core' : demand.get(b.source);
    if (!kind) continue;
    const m = metas[b.source];
    const fullEvery = b.core ? CORE_FULL_MS : DEPT_FULL_MS;
    const quickEvery = b.core ? 0 : kind === 'alert' ? ALERTED_QUICK_MS : VIEWED_QUICK_MS;
    if (!m || now - m.scrapedAt >= fullEvery) {
      if (b.core) full.push(b.source);
      else deptFull.push([b.source, m?.scrapedAt ?? 0]);
    } else if (now - m.checkedAt >= quickEvery) {
      if (b.core) quick.push(b.source);
      else deptQuick.push([b.source, m.checkedAt]);
    }
  }
  // Longest-waiting first; the rest wait for the next run.
  const oldest = (xs: [string, number][], n: number) => xs.sort((a, b) => a[1] - b[1]).slice(0, n).map(([id]) => id);
  return { quick: [...quick, ...oldest(deptQuick, MAX_DEPT_QUICK)], full: [...full, ...oldest(deptFull, MAX_DEPT_FULL)] };
}

// ---------- reading one board ----------

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** A stored full title still belongs to a notice if it contains the listed (possibly cut) title. */
function matchesListed(full: string | undefined, listed: string): full is string {
  return typeof full === 'string' && full.length > 0 && squash(full).includes(squash(withoutCutMarker(listed)).slice(0, 30));
}

/** Full titles for listed titles that may be cut: newest first, a few per read, 4 at a time. */
async function lookUpFullTitles(notices: ScrapedNotice[], known: Record<string, string>): Promise<Record<string, string>> {
  const lookups = sortNotices(notices.filter((n) => mayBeCutOff(n) && !matchesListed(known[n.id], n.title))).slice(0, TITLE_LOOKUPS_PER_READ);
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

/** Earlier versions kept one hash for all boards; core boards take their entries over once. */
async function legacyHash(redis: Redis, legacyKey: string, board: Board): Promise<Record<string, string | number>> {
  if (!board.core) return {};
  const all = ((await redis.hgetall<Record<string, string | number>>(legacyKey).catch(() => null)) ?? {}) as Record<string, string | number>;
  return Object.fromEntries(Object.entries(all).filter(([id]) => id.startsWith(`${board.idPrefix}_`)));
}

/** Reads every page of one board and stores it. A board that fails keeps its previous notices. */
async function readBoardFully(redis: Redis, board: Board, now: number, previous: BoardSnapshot | null): Promise<BoardSnapshot> {
  const result = await scrapeBoard(board, now);
  const [seenRaw, titlesRaw] = (await Promise.all([
    redis.hgetall<Record<string, number>>(NOTICE_KEYS.firstSeen(board.source)),
    redis.hgetall<Record<string, string>>(NOTICE_KEYS.fullTitles(board.source)),
  ])) as [Record<string, number> | null, Record<string, string> | null];
  let firstSeen = seenRaw;
  if (!firstSeen) {
    firstSeen = (await legacyHash(redis, KEYS.firstSeen, board)) as Record<string, number>;
    if (Object.keys(firstSeen).length > 0) await redis.hset(NOTICE_KEYS.firstSeen(board.source), firstSeen);
  }
  const fullTitles = titlesRaw ?? ((await legacyHash(redis, KEYS.fullTitles, board)) as Record<string, string>);
  const seen = firstSeen;
  const isFirstRead = Object.keys(seen).length === 0;

  const ok = result.ok && result.notices.length > 0;
  const scraped: ScrapedNotice[] = ok ? result.notices : (previous?.notices ?? []);
  const failingSince = ok ? null : (previous?.failingSince ?? now);

  const found = ok ? await lookUpFullTitles(scraped, fullTitles) : {};
  if (Object.keys(found).length > 0) {
    await redis.hset(NOTICE_KEYS.fullTitles(board.source), found);
    Object.assign(fullTitles, found);
  }

  const additions: Record<string, number> = {};
  const notices: Notice[] = scraped.map((n) => {
    let at = seen[n.id];
    if (at === undefined) {
      // A board's very first read dates everything by its post date, so nothing old counts as "new".
      at = isFirstRead ? (n.postedAt ?? now) : now;
      additions[n.id] = at;
    }
    const full = fullTitles[n.id];
    return { ...n, title: matchesListed(full, n.title) ? full : n.title, firstSeenAt: Number(at) };
  });
  if (Object.keys(additions).length > 0) await redis.hset(NOTICE_KEYS.firstSeen(board.source), additions);

  if (ok) {
    const current = new Set(notices.map((n) => n.id));
    const oldSeen = Object.entries(seen).filter(([id, t]) => !current.has(id) && Number(t) < now - FORGET_AFTER_MS).map(([id]) => id);
    if (oldSeen.length > 0) await redis.hdel(NOTICE_KEYS.firstSeen(board.source), ...oldSeen);
    const oldTitles = Object.keys(fullTitles).filter((id) => !current.has(id));
    if (oldTitles.length > 0 && titlesRaw) await redis.hdel(NOTICE_KEYS.fullTitles(board.source), ...oldTitles);
  }

  const snapshot: BoardSnapshot = { board: board.source, scrapedAt: now, failingSince, notices: sortNotices(notices) };
  await redis.set(NOTICE_KEYS.board(board.source), snapshot);
  return snapshot;
}

export async function readBoards(redis: Redis, ids: string[]): Promise<BoardSnapshot[]> {
  if (ids.length === 0) return [];
  const raw = await redis.mget<(BoardSnapshot | null)[]>(...ids.map(NOTICE_KEYS.board)).catch(() => [] as (BoardSnapshot | null)[]);
  return raw.filter((s): s is BoardSnapshot => Boolean(s && Array.isArray(s.notices)));
}

export type CheckResult = {
  /** Boards read fully this run (they may have new notices). */
  refreshed: BoardSnapshot[];
  /** Every board looked at this run. */
  checked: string[];
  metas: Record<string, BoardMeta>;
};

/**
 * Carries out a plan: page-1 checks first (each becomes a full read if page 1
 * shows something new, or the board's failing state changed), then full reads.
 */
export async function checkBoards(redis: Redis, now: number, plan: CheckPlan, metas: Record<string, BoardMeta>): Promise<CheckResult> {
  const updated: Record<string, BoardMeta> = {};
  const full = new Set(plan.full);

  const quick = plan.quick.filter((id) => !full.has(id) && boardBySource(id));
  for (let i = 0; i < quick.length; i += 4) {
    const chunk = quick.slice(i, i + 4);
    const pages = await Promise.all(chunk.map((id) => scrapeFirstPage(boardBySource(id)!, now)));
    pages.forEach((page, j) => {
      const id = chunk[j];
      const m = metas[id];
      const wasFailing = m?.failingSince != null;
      if (!m || (!page.ok && !wasFailing) || (page.ok && (wasFailing || page.ids.some((x) => !m.ids.includes(x))))) full.add(id);
      else updated[id] = { ...m, checkedAt: now };
    });
  }

  const fullIds = [...full].filter((id) => boardBySource(id));
  const previous = new Map((await readBoards(redis, fullIds)).map((s) => [s.board, s]));
  const refreshed: BoardSnapshot[] = [];
  for (let i = 0; i < fullIds.length; i += 3) {
    const chunk = fullIds.slice(i, i + 3);
    const snaps = await Promise.all(chunk.map((id) => readBoardFully(redis, boardBySource(id)!, now, previous.get(id) ?? null)));
    for (const s of snaps) {
      refreshed.push(s);
      updated[s.board] = { checkedAt: now, scrapedAt: now, failingSince: s.failingSince, ids: s.notices.map((n) => n.id) };
    }
  }

  if (Object.keys(updated).length > 0) await redis.hset(NOTICE_KEYS.meta, updated);
  return { refreshed, checked: [...new Set([...quick, ...fullIds])], metas: { ...metas, ...updated } };
}

/** Several boards as one list. */
export function combine(snapshots: BoardSnapshot[], metas: Record<string, BoardMeta> = {}): NoticeSnapshot {
  const failingSince: Record<string, number> = {};
  for (const s of snapshots) if (s.failingSince != null) failingSince[s.board] = s.failingSince;
  const checked = snapshots.map((s) => Math.max(s.scrapedAt, metas[s.board]?.checkedAt ?? 0));
  return {
    updatedAt: checked.length ? Math.max(...checked) : 0,
    scrapedAt: snapshots.length ? Math.min(...snapshots.map((s) => s.scrapedAt)) : 0,
    notices: sortNotices(snapshots.flatMap((s) => s.notices)),
    staleSources: Object.keys(failingSince),
    failingSince,
  };
}

// ---------- page views (and no-Redis development) ----------

const memoryTitles: Record<string, string> = {};

/**
 * Reads these boards fully right now. Used by page views when a board has
 * never been read or the cron isn't running. Without Redis (local
 * development) it simply scrapes them.
 */
export async function refreshNotices(
  now = Date.now(),
  opts: { boards?: string[]; locked?: boolean } = {},
): Promise<{ snapshot: NoticeSnapshot; changed: boolean }> {
  const ids = (opts.boards ?? BOARDS.filter((b) => b.core).map((b) => b.source)).filter((id) => boardBySource(id));
  const redis = getRedis();
  if (!redis) {
    const results = await Promise.all(ids.map((id) => scrapeBoard(boardBySource(id)!, now)));
    const scraped = results.flatMap((r) => r.notices);
    Object.assign(memoryTitles, await lookUpFullTitles(scraped, memoryTitles));
    const notices = scraped.map((n) => ({
      ...n,
      title: matchesListed(memoryTitles[n.id], n.title) ? memoryTitles[n.id] : n.title,
      firstSeenAt: n.postedAt ?? now,
    }));
    const failing = results.filter((r) => !r.ok).map((r) => r.source);
    return {
      snapshot: {
        updatedAt: now,
        scrapedAt: now,
        notices: sortNotices(notices),
        staleSources: failing,
        failingSince: Object.fromEntries(failing.map((s) => [s, now])),
      },
      changed: true,
    };
  }

  const run = async () => {
    const metas = await readMeta(redis);
    const result = await checkBoards(redis, now, { quick: [], full: ids }, metas);
    return { snapshot: combine(result.refreshed, result.metas), changed: true };
  };
  if (opts.locked) return run();
  // Same lock as the cron run, so a page view and a cron call never read the same boards at once.
  const out = await withLock(redis, KEYS.runLock, 55, run);
  if (out) return out;
  return { snapshot: combine(await readBoards(redis, ids)), changed: false };
}
