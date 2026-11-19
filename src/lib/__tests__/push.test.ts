import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { FakeRedis } from './fakeRedis';
import { setRedisForTesting, KEYS } from '../redis';
import { runNotificationCycle } from '../push';
import { refreshNotices, BOARD_DOWN_ALERT_MS, FULL_REFRESH_MS } from '../notices';
import * as scrape from '../scrapeNotices';
import { OWNER_KEYS } from '../owner';
import type { NoticeSource, ScrapedNotice } from '../scrapeNotices';

vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));

// Owner mode: PLATO/NESPA results are simulated; syncOwner stores whatever ownerFixture holds.
let ownerFixture: unknown = null;
vi.mock('../ownerSync', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ownerSync')>();
  const { getRedis } = await import('../redis');
  const { OWNER_KEYS } = await import('../owner');
  return {
    ...real,
    syncOwner: vi.fn(async (now: number) => {
      const data = { checkedAt: now, ...(ownerFixture as object) };
      await getRedis()!.set(OWNER_KEYS.data, data);
      return data;
    }),
  };
});

// The boards are simulated: each test sets what they return. null = the site is down.
const boards: Record<NoticeSource, ScrapedNotice[] | null> = { cse: [], international: [] };
vi.mock('../scrapeNotices', async (importOriginal) => {
  const real = await importOriginal<typeof import('../scrapeNotices')>();
  const result = (source: NoticeSource) => ({ source, ok: boards[source] !== null, notices: boards[source] ?? [] });
  return {
    ...real,
    scrapeAllBoards: vi.fn(async () => [result('cse'), result('international')]),
    checkFirstPages: vi.fn(async () =>
      (['cse', 'international'] as const).map((source) => ({ source, ok: boards[source] !== null, ids: (boards[source] ?? []).map((n) => n.id) })),
    ),
    fetchFullTitle: vi.fn(async (n: { title: string }) => ({ ok: true, title: `${n.title} (full)` })),
  };
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-11-19T09:00:00+09:00');
const send = vi.mocked(webpush.sendNotification);
let redis: FakeRedis;

function notice(n: number, source: NoticeSource = 'cse', postedAt = T0, title = `Notice ${n}`): ScrapedNotice {
  const prefix = source === 'cse' ? 'cse' : 'intl';
  return { id: `${prefix}_${n}`, title, date: '2026.11.19', postedAt, source, url: `https://example.pusan.ac.kr/${n}`, pinned: false };
}

function addDevice(id: string, categories: Partial<Record<'cse' | 'international' | 'tasks' | 'courses', boolean>>, tasks: unknown[] = []) {
  redis.kv.set(KEYS.subscription(id), { endpoint: `https://push.example/${id}`, keys: { p256dh: 'p', auth: 'a' } });
  redis.kv.set(KEYS.categories(id), { cse: false, international: false, tasks: false, courses: false, ...categories });
  redis.kv.set(KEYS.tasks(id), tasks);
  redis.sets.set(KEYS.devices, new Set([...(redis.sets.get(KEYS.devices) ?? []), id]));
}

const sentTo = (id: string) =>
  send.mock.calls.filter(([sub]) => (sub as { endpoint: string }).endpoint.endsWith(`/${id}`)).map(([, body]) => JSON.parse(String(body)));

beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTesting(redis.asRedis());
  boards.cse = [notice(1), notice(2)];
  boards.international = [notice(10, 'international')];
  send.mockReset();
  send.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  vi.mocked(scrape.scrapeAllBoards).mockClear();
  vi.mocked(scrape.fetchFullTitle).mockClear();
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
});

afterEach(() => setRedisForTesting(null));

describe('new notice alerts', () => {
  it('sends nothing on the very first run, then each new notice exactly once', async () => {
    addDevice('a', { cse: true });
    addDevice('b', { international: true });

    await runNotificationCycle(T0);
    expect(send).not.toHaveBeenCalled();

    boards.cse = [notice(3, 'cse', T0 + MIN), ...boards.cse!];
    const report = await runNotificationCycle(T0 + MIN);
    expect(report).toMatchObject({ checked: 'full', freshNotices: 1, sent: 1 });
    expect(sentTo('a')).toEqual([{ title: 'New CSE notice', body: 'Notice 3', url: '/?tab=notices&notice=cse_3', tag: 'notice-cse_3' }]);
    expect(sentTo('b')).toEqual([]);

    await runNotificationCycle(T0 + 2 * MIN);
    await runNotificationCycle(T0 + 40 * MIN); // a full re-read later still doesn't resend
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends one summary instead of a flood when more than 3 arrive together', async () => {
    addDevice('a', { cse: true });
    await runNotificationCycle(T0);
    boards.cse = [3, 4, 5, 6].map((n) => notice(n)).concat(boards.cse!);
    await runNotificationCycle(T0 + MIN);
    expect(sentTo('a')).toHaveLength(1);
    expect(sentTo('a')[0]).toMatchObject({ title: '4 new PNU notices', tag: 'notices-summary' });
  });

  it('never alerts about old notices that only now appear (e.g. a board that was down)', async () => {
    addDevice('a', { cse: true });
    await runNotificationCycle(T0);
    boards.cse = [notice(7, 'cse', T0 - 10 * 24 * HOUR), ...boards.cse!];
    await runNotificationCycle(T0 + MIN);
    expect(send).not.toHaveBeenCalled();
  });

  it('marks pushed notices with high urgency so phones deliver them right away', async () => {
    addDevice('a', { cse: true });
    await runNotificationCycle(T0);
    boards.cse = [notice(3), ...boards.cse!];
    await runNotificationCycle(T0 + MIN);
    expect(send.mock.calls[0][2]).toMatchObject({ urgency: 'high' });
  });
});

describe('checking every minute stays cheap', () => {
  it('reads only page 1 when nothing is new, using a handful of Redis commands', async () => {
    addDevice('a', { cse: true, tasks: true });
    await runNotificationCycle(T0);
    expect(scrape.scrapeAllBoards).toHaveBeenCalledTimes(1);

    redis.commands = 0;
    const report = await runNotificationCycle(T0 + MIN);
    expect(report.checked).toBe('quick');
    expect(scrape.scrapeAllBoards).toHaveBeenCalledTimes(1);
    // lock, snapshot read, checked-at write, deadline-check read, lock release
    expect(redis.commands).toBeLessThanOrEqual(5);
  });

  it('still re-reads every page every 30 minutes', async () => {
    await runNotificationCycle(T0);
    await runNotificationCycle(T0 + FULL_REFRESH_MS + MIN);
    expect(scrape.scrapeAllBoards).toHaveBeenCalledTimes(2);
  });

  it('reads all devices in one batch instead of four commands each', async () => {
    for (let i = 0; i < 30; i++) addDevice(`d${i}`, { cse: true });
    await runNotificationCycle(T0);
    boards.cse = [notice(3), ...boards.cse!];
    redis.commands = 0;
    await runNotificationCycle(T0 + MIN);
    expect(send).toHaveBeenCalledTimes(30);
    expect(redis.commands).toBeLessThan(20);
  });

  it('serves the stored snapshot to page views and skips scraping when a run is already going', async () => {
    await runNotificationCycle(T0);
    redis.kv.set(KEYS.runLock, 'someone-else');
    const { snapshot, changed } = await refreshNotices(T0 + 20 * MIN, { quick: true });
    expect(changed).toBe(false);
    expect(snapshot.notices).toHaveLength(3);
    expect(scrape.scrapeAllBoards).toHaveBeenCalledTimes(1);
  });
});

describe('a board that is down', () => {
  it('keeps its last notices, and reports it as down after 3 hours', async () => {
    await runNotificationCycle(T0);
    boards.international = null;

    const first = await runNotificationCycle(T0 + MIN);
    expect(first.staleSources).toEqual(['international']);
    expect(first.boardsDown).toEqual([]);
    expect(first.noticeCount).toBe(3);

    // While it stays down, minute checks don't trigger a full re-read each time.
    vi.mocked(scrape.scrapeAllBoards).mockClear();
    await runNotificationCycle(T0 + 2 * MIN);
    expect(scrape.scrapeAllBoards).not.toHaveBeenCalled();

    const later = await runNotificationCycle(T0 + MIN + BOARD_DOWN_ALERT_MS);
    expect(later.boardsDown).toEqual(['international']);

    boards.international = [notice(10, 'international')];
    const back = await runNotificationCycle(T0 + 2 * MIN + BOARD_DOWN_ALERT_MS);
    expect(back).toMatchObject({ checked: 'full', staleSources: [], boardsDown: [] });
  });
});

describe('deadline reminders', () => {
  const task = (dueDate: number) => ({ id: 't1', title: 'OS homework', course: 'OS', dueDate });

  it('sends the 24 h and the 1 h reminder once each', async () => {
    const due = T0 + 23 * HOUR;
    addDevice('a', { tasks: true }, [task(due)]);

    await runNotificationCycle(T0);
    expect(sentTo('a')).toEqual([{ title: 'Due in 23 hours', body: 'OS homework · OS', url: '/?tab=tasks', tag: 'task-t1' }]);

    await runNotificationCycle(T0 + 10 * MIN);
    expect(sentTo('a')).toHaveLength(1);

    await runNotificationCycle(due - 50 * MIN);
    await runNotificationCycle(due - 40 * MIN);
    expect(sentTo('a').map((p) => p.title)).toEqual(['Due in 23 hours', 'Due in 50 min']);
    expect(send.mock.calls[1][2]).toMatchObject({ urgency: 'high' });
  });

  it('never reminds about overdue tasks, or when reminders are off', async () => {
    addDevice('a', { tasks: true }, [task(T0 - HOUR)]);
    addDevice('b', { tasks: false }, [task(T0 + 2 * HOUR)]);
    await runNotificationCycle(T0);
    expect(send).not.toHaveBeenCalled();
  });

  it('records a reminder before sending it, so an overlapping run never repeats it', async () => {
    addDevice('a', { tasks: true }, [task(T0 + 30 * MIN)]);
    // A slow send outlives the run lock, and the next cron call starts mid-send.
    send.mockImplementationOnce(async () => {
      redis.kv.delete(KEYS.runLock);
      redis.kv.delete(KEYS.deadlinesCheckedAt);
      await runNotificationCycle(T0 + 5 * MIN);
      return { statusCode: 201, body: '', headers: {} };
    });
    await runNotificationCycle(T0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('checks reminders every ~5 minutes, not on every minute run', async () => {
    addDevice('a', { tasks: true }, []);
    expect((await runNotificationCycle(T0)).deadlinesChecked).toBe(true);
    expect((await runNotificationCycle(T0 + MIN)).deadlinesChecked).toBe(false);
    expect((await runNotificationCycle(T0 + 5 * MIN)).deadlinesChecked).toBe(true);
  });
});

describe('subscriptions', () => {
  it('removes a device the push service says is gone (410), but keeps one on 403', async () => {
    addDevice('gone', { cse: true });
    addDevice('mismatch', { cse: true });
    await runNotificationCycle(T0);
    boards.cse = [notice(3), ...boards.cse!];
    send.mockImplementation(async (sub) => {
      const endpoint = (sub as { endpoint: string }).endpoint;
      throw Object.assign(new Error('rejected'), { statusCode: endpoint.endsWith('/gone') ? 410 : 403 });
    });
    const report = await runNotificationCycle(T0 + MIN);
    expect(report.pruned).toBe(1);
    expect([...(redis.sets.get(KEYS.devices) ?? [])]).toEqual(['mismatch']);
  });
});

describe('cut-off titles', () => {
  it('replaces long titles with the full one, looked up once', async () => {
    const long = 'x'.repeat(50); // CSE cuts at 50
    boards.cse = [notice(1, 'cse', T0, long)];
    const { snapshot } = await refreshNotices(T0);
    expect(snapshot.notices.find((n) => n.id === 'cse_1')!.title).toBe(`${long} (full)`);
    expect(snapshot.notices.find((n) => n.id === 'intl_10')!.title).toBe('Notice 10');

    await refreshNotices(T0 + FULL_REFRESH_MS + MIN);
    expect(scrape.fetchFullTitle).toHaveBeenCalledTimes(1);
  });
});

describe('without Redis', () => {
  it('does nothing and says why', async () => {
    setRedisForTesting(null);
    await expect(runNotificationCycle(T0)).resolves.toMatchObject({ ok: false, skipped: 'redis-not-configured' });
  });
});

describe('owner mode', () => {
  const plato = (deadlines: unknown[], announcements: unknown[] = []) => ({
    configured: true,
    ok: true,
    data: { name: 'Me', courses: [], deadlines, announcements },
  });
  const nespa = { configured: false, ok: false };

  beforeEach(() => {
    process.env.OWNER_SECRET = 'o'.repeat(48);
    ownerFixture = { plato: plato([]), nespa };
  });
  afterEach(() => {
    delete process.env.OWNER_SECRET;
  });

  it('sends new PLATO announcements only to owner devices with course alerts on', async () => {
    addDevice('mine', { courses: true });
    addDevice('stranger', { courses: true, cse: true });
    redis.sets.set(OWNER_KEYS.devices, new Set(['mine']));
    await runNotificationCycle(T0);

    ownerFixture = {
      plato: plato([], [{ id: 'platonews_9', title: 'Quiz moved to Friday', course: 'OS', author: 'Prof', postedAt: T0, url: 'https://plato.pusan.ac.kr/x', excerpt: '' }]),
      nespa,
    };
    await runNotificationCycle(T0 + 21 * MIN);
    expect(sentTo('mine')).toEqual([{ title: 'PLATO · OS', body: 'Quiz moved to Friday', url: '/?tab=briefing', tag: 'platonews_9' }]);
    expect(sentTo('stranger')).toEqual([]);

    await runNotificationCycle(T0 + 42 * MIN);
    expect(sentTo('mine')).toHaveLength(1);
  });

  it('adds PLATO deadlines to owner reminders, skipping ones marked done', async () => {
    const due = T0 + 50 * MIN;
    ownerFixture = {
      plato: plato([
        { id: 'plato_1', title: 'HW1', course: 'OS', dueAt: due, url: 'u', kind: 'assign' },
        { id: 'plato_2', title: 'HW2', course: 'OS', dueAt: due, url: 'u', kind: 'assign' },
      ]),
      nespa,
    };
    redis.kv.set(OWNER_KEYS.state, { tasks: [], deleted: {}, readIds: [], external: { plato_2: { done: true, at: 1 } } });
    addDevice('mine', { tasks: true });
    addDevice('stranger', { tasks: true });
    redis.sets.set(OWNER_KEYS.devices, new Set(['mine']));

    await runNotificationCycle(T0);
    expect(sentTo('mine').map((x) => x.body)).toEqual(['HW1 · OS']);
    expect(sentTo('stranger')).toEqual([]);
  });

  it('leaves the quick per-minute run untouched when PLATO was synced recently', async () => {
    addDevice('mine', { courses: true });
    redis.sets.set(OWNER_KEYS.devices, new Set(['mine']));
    await runNotificationCycle(T0);
    redis.commands = 0;
    await runNotificationCycle(T0 + MIN);
    // the usual 5, plus reading the owner's sync time
    expect(redis.commands).toBeLessThanOrEqual(6);
  });
});
