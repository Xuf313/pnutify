import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from './fakeRedis';
import { setRedisForTesting } from '../redis';
import { isOwnerRequest, ownerCookie, OWNER_KEYS, seal, tryUnlock, unseal } from '../owner';
import { flattenParams, fetchPlato, platoLogin, PlatoLoginError } from '../plato';
import { nespaLogin, NespaLoginError, parseNespaDate, parseNoticeBoard, parseSubmissionList } from '../nespa';
import { mergeStates, normalizeState, syncOwner, type OwnerState } from '../ownerSync';
import { GET as getOwnerDataRoute } from '../../app/api/owner/data/route';
import { GET as getOwnerStateRoute } from '../../app/api/owner/state/route';

const SECRET = 'x'.repeat(48);
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');
let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTesting(redis.asRedis());
  process.env.OWNER_SECRET = SECRET;
});
afterEach(() => {
  setRedisForTesting(null);
  vi.unstubAllGlobals();
  delete process.env.OWNER_SECRET;
  for (const k of ['PLATO_ID', 'PLATO_PW', 'NESPA_ID', 'NESPA_PW']) delete process.env[k];
});

const cookieValue = () => ownerCookie().split(';')[0];
const req = (cookie?: string) => new Request('https://www.pnutify.app/api/owner/data', cookie ? { headers: { cookie } } : {});

describe('only the owner gets in', () => {
  it('accepts the owner cookie and nothing else', () => {
    expect(isOwnerRequest(req(cookieValue()))).toBe(true);
    expect(isOwnerRequest(req())).toBe(false);
    expect(isOwnerRequest(req('pnutify_owner=guess'))).toBe(false);
    expect(isOwnerRequest(req(`pnutify_owner=${SECRET}`))).toBe(false); // the secret itself is not the cookie
  });

  it('the cookie is httpOnly and Secure, and never contains the secret', () => {
    const c = ownerCookie();
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).not.toContain(SECRET);
  });

  it('changing OWNER_SECRET signs every device out', () => {
    const old = cookieValue();
    process.env.OWNER_SECRET = 'y'.repeat(48);
    expect(isOwnerRequest(req(old))).toBe(false);
  });

  it('is off entirely when OWNER_SECRET is missing or short', () => {
    const c = cookieValue();
    process.env.OWNER_SECRET = 'short';
    expect(isOwnerRequest(req(c))).toBe(false);
    delete process.env.OWNER_SECRET;
    expect(isOwnerRequest(req(c))).toBe(false);
  });

  it('the data and state endpoints return nothing to other visitors', async () => {
    redis.kv.set(OWNER_KEYS.data, { checkedAt: Date.now(), plato: { configured: true, ok: true, data: { name: 'Secret Student' } }, nespa: {} });
    const res = await getOwnerDataRoute(req());
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('Secret Student');
    expect((await getOwnerStateRoute(req())).status).toBe(401);

    const mine = await getOwnerDataRoute(req(cookieValue()));
    expect(mine.status).toBe(200);
    expect(mine.headers.get('cache-control')).toContain('private');
  });
});

describe('unlocking', () => {
  it('registers the device on the right key', async () => {
    await expect(tryUnlock(SECRET, 'device-12345')).resolves.toEqual({ ok: true });
    expect(redis.sets.get(OWNER_KEYS.devices)?.has('device-12345')).toBe(true);
  });

  it('locks unlocking after 10 wrong keys, even for the right one', async () => {
    for (let i = 0; i < 10; i++) await expect(tryUnlock(`wrong-${i}`, 'device-12345')).resolves.toEqual({ ok: false, reason: 'wrong-key' });
    await expect(tryUnlock(SECRET, 'device-12345')).resolves.toEqual({ ok: false, reason: 'locked' });
  });
});

describe('encryption at rest', () => {
  it('round-trips and fails closed on tampering or a different secret', () => {
    const sealed = seal('moodle-token-123');
    expect(sealed).not.toContain('moodle-token-123');
    expect(unseal(sealed)).toBe('moodle-token-123');
    expect(unseal(sealed.slice(0, -2) + 'AA')).toBeNull();
    process.env.OWNER_SECRET = 'z'.repeat(48);
    expect(unseal(sealed)).toBeNull();
  });
});

// ---------- PLATO ----------

type Handler = (url: string, body: URLSearchParams) => unknown;
function stubJsonFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ''));
    return new Response(JSON.stringify(handler(String(url), body)), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const NOW = Date.parse('2026-11-19T12:00:00+09:00');
const sec = (ms: number) => Math.floor(ms / 1000);

function fakePlato(opts: { validToken?: string; password?: string } = {}) {
  const valid = opts.validToken ?? 'tok-1';
  return stubJsonFetch((url, b) => {
    if (url.endsWith('/login/token.php')) {
      return b.get('password') === (opts.password ?? 'pw') ? { token: valid } : { error: 'x', errorcode: 'invalidlogin' };
    }
    if (b.get('wstoken') !== valid) return { exception: 'webservice_access_exception', errorcode: 'invalidtoken' };
    switch (b.get('wsfunction')) {
      case 'core_webservice_get_site_info':
        return { userid: 7, fullname: 'Test Student' };
      case 'core_enrol_get_users_courses':
        return [
          { id: 1, fullname: '자료구조', visible: 1, enddate: sec(NOW + 30 * 86_400_000) },
          { id: 2, fullname: 'Old course', visible: 1, enddate: sec(NOW - 90 * 86_400_000) },
        ];
      case 'core_calendar_get_action_events_by_timesort':
        return { events: [{ id: 55, name: 'HW3 is due', timesort: sec(NOW + 86_400_000), url: 'https://plato.pusan.ac.kr/mod/assign/view.php?id=9', modulename: 'assign', course: { id: 1, fullname: '자료구조' } }] };
      case 'mod_forum_get_forums_by_courses':
        return [{ id: 100, course: 1, type: 'news' }, { id: 101, course: 1, type: 'general' }];
      case 'mod_forum_get_forum_discussions':
        return { discussions: [{ id: 5, discussion: 77, name: 'Midterm room change', created: sec(NOW - 3600_000), userfullname: 'Prof', message: '<p>Room <b>201</b></p>' }] };
      default:
        return { exception: 'x', errorcode: 'unknown' };
    }
  });
}

describe('PLATO client', () => {
  it('encodes arrays and objects the way Moodle expects', () => {
    expect(flattenParams({ courseids: [3, 4], options: { a: 1 }, x: 'y' })).toEqual({ 'courseids[0]': '3', 'courseids[1]': '4', 'options[a]': '1', x: 'y' });
  });

  it('reads deadlines, current courses and announcements', async () => {
    fakePlato();
    const data = await fetchPlato('tok-1', NOW);
    expect(data.name).toBe('Test Student');
    expect(data.courses).toEqual([{ id: 1, name: '자료구조' }]);
    expect(data.deadlines).toEqual([
      { id: 'plato_55', title: 'HW3', course: '자료구조', dueAt: NOW + 86_400_000 - (NOW % 1000), url: 'https://plato.pusan.ac.kr/mod/assign/view.php?id=9', kind: 'assign' },
    ]);
    expect(data.announcements).toHaveLength(1);
    expect(data.announcements[0]).toMatchObject({ id: 'platonews_77', title: 'Midterm room change', course: '자료구조', excerpt: 'Room 201' });
  });

  it('reports a rejected password as its own error', async () => {
    fakePlato();
    await expect(platoLogin('id', 'wrong')).rejects.toBeInstanceOf(PlatoLoginError);
  });
});

describe('owner sync', () => {
  beforeEach(() => {
    process.env.PLATO_ID = 'id';
    process.env.PLATO_PW = 'pw';
  });

  it('logs in once, stores only an encrypted access key, and reuses it', async () => {
    const fetchMock = fakePlato();
    const data = await syncOwner(NOW);
    expect(data?.plato).toMatchObject({ ok: true, syncedAt: NOW });
    const stored = redis.kv.get(OWNER_KEYS.platoToken) as string;
    expect(stored).not.toContain('tok-1');
    expect(unseal(stored)).toBe('tok-1');
    expect(JSON.stringify([...redis.kv.values()])).not.toContain('"pw"');

    fetchMock.mockClear();
    await syncOwner(NOW + 60_000);
    const logins = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/login/token.php'));
    expect(logins).toHaveLength(0);
  });

  it('logs in again when the access key stops working', async () => {
    fakePlato({ validToken: 'tok-1' });
    await syncOwner(NOW);
    fakePlato({ validToken: 'tok-2' });
    const data = await syncOwner(NOW + 60_000);
    expect(data?.plato.ok).toBe(true);
    expect(unseal(redis.kv.get(OWNER_KEYS.platoToken))).toBe('tok-2');
  });

  it('never retries a rejected password for 6 hours (protects the account from lockout)', async () => {
    process.env.PLATO_PW = 'wrong';
    const fetchMock = fakePlato();
    const first = await syncOwner(NOW);
    expect(first?.plato.ok).toBe(false);
    expect(first?.plato.error).toMatch(/PLATO_ID \/ PLATO_PW/);

    fetchMock.mockClear();
    await syncOwner(NOW + 60 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();

    await syncOwner(NOW + 7 * 60 * 60_000);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('keeps the last good PLATO data when PLATO is down', async () => {
    fakePlato();
    await syncOwner(NOW);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const data = await syncOwner(NOW + 60_000);
    expect(data?.plato.ok).toBe(false);
    expect(data?.plato.data?.deadlines).toHaveLength(1);
  });
});

// ---------- NESPA ----------

describe('NESPA', () => {
  const now = Date.parse('2026-11-19T20:00:00+09:00');

  it('reads the real assignment list with KST due dates', () => {
    const list = parseSubmissionList(fixture('nespa-submissions'), now);
    expect(list.length).toBeGreaterThan(10);
    expect(list[0]).toMatchObject({ id: 'nespa_16', no: 16, title: 'Carrier Center', score: null, dueAt: Date.parse('2026-11-24T22:00:00+09:00') });
  });

  it('reads the real notice board with exact post times', () => {
    const notices = parseNoticeBoard(fixture('nespa-notices'));
    expect(notices.length).toBeGreaterThan(10);
    expect(notices[0]).toMatchObject({ id: 'nespanotice_170', author: 'Zprof', postedAt: Date.parse('2026-11-17T13:21:27+09:00') });
    expect(notices[0].title).toBe('GraphTea : 그래프 자료구조 실습용 app.');
    expect(new Set(notices.map((n) => n.id)).size).toBe(notices.length);
  });

  it('picks the right year for dates written without one', () => {
    expect(parseNespaDate('12/30 22:00', Date.parse('2027-01-02T09:00:00+09:00'))).toBe(Date.parse('2026-12-30T22:00:00+09:00'));
    expect(parseNespaDate('01/03 22:00', Date.parse('2026-12-28T09:00:00+09:00'))).toBe(Date.parse('2027-01-03T22:00:00+09:00'));
    expect(parseNespaDate('soon')).toBeNull();
  });

  it('logs in with the CSRF token and keeps the session cookie', async () => {
    const calls: { method: string; body: string; cookie: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        calls.push({ method: init?.method ?? 'GET', body: String(init?.body ?? ''), cookie: headers.get('cookie') ?? '' });
        if ((init?.method ?? 'GET') === 'GET') {
          return new Response('<form><input name="csrfmiddlewaretoken" value="CSRF1"></form>', { headers: { 'set-cookie': 'csrftoken=C1; Path=/' } });
        }
        const good = new URLSearchParams(String(init?.body)).get('password') === 'pw';
        return good
          ? new Response(null, { status: 302, headers: { location: '/ds2026/', 'set-cookie': 'sessionid=S1; Path=/' } })
          : new Response('<form>again</form>', { status: 200 });
      }),
    );
    await expect(nespaLogin('me', 'pw')).resolves.toEqual({ csrftoken: 'C1', sessionid: 'S1' });
    expect(calls[1].body).toContain('csrfmiddlewaretoken=CSRF1');
    expect(calls[1].cookie).toContain('csrftoken=C1');
    await expect(nespaLogin('me', 'bad')).rejects.toBeInstanceOf(NespaLoginError);
  });
});

// ---------- syncing the owner's devices ----------

describe('merging two devices', () => {
  const task = (id: string, updatedAt: number, title = id) => ({ id, title, course: 'General', dueDate: 1, status: 'pending' as const, createdAt: 1, updatedAt });
  const state = (p: Partial<OwnerState>): OwnerState => normalizeState({ tasks: [], deleted: {}, readIds: [], external: {}, ...p }, 1000);

  it('keeps the newest edit, honours deletions, and never un-reads', () => {
    const phone = state({ tasks: [task('a', 10, 'old title'), task('b', 5)], readIds: ['n1'], external: { plato_1: { done: true, at: 20 } } });
    const laptop = state({ tasks: [task('a', 30, 'new title'), task('c', 7)], deleted: { b: 6 }, readIds: ['n2'], external: { plato_1: { done: false, at: 10 } } });
    const merged = mergeStates(phone, laptop);
    expect(merged.tasks.map((t) => [t.id, t.title]).sort()).toEqual([
      ['a', 'new title'],
      ['c', 'c'],
    ]);
    expect(merged.readIds.sort()).toEqual(['n1', 'n2']);
    expect(merged.external.plato_1).toEqual({ done: true, at: 20 });
  });

  it('keeps "cleared" on PLATO/NESPA items so Clear done sticks on every device', () => {
    const merged = mergeStates(state({ external: { plato_1: { done: true, cleared: true, at: 30 } } }), state({ external: { plato_1: { done: true, at: 10 } } }));
    expect(merged.external.plato_1).toEqual({ done: true, cleared: true, at: 30 });
  });

  it('a task edited after it was deleted elsewhere comes back', () => {
    const merged = mergeStates(state({ tasks: [task('a', 50)] }), state({ deleted: { a: 40 } }));
    expect(merged.tasks.map((t) => t.id)).toEqual(['a']);
  });
});
