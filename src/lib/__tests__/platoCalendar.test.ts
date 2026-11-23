import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from './fakeRedis';
import { setRedisForTesting } from '../redis';
import {
  CAL_KEYS,
  linkCalendar,
  normalizeCalendarUrl,
  parseCalendar,
  readCalendar,
  refreshCalendars,
  REFRESH_EVERY_MS,
  unlinkCalendar,
  withCalendar,
} from '../platoCalendar';

const T0 = Date.parse('2026-11-24T09:00:00+09:00');
const MIN = 60_000;
const TOKEN = 'a3f9c2e8b1d4f6a7c9e0b2d4f6a8c0e2b4d6f8a1';
const LINK = `https://plato.pusan.ac.kr/calendar/export_execute.php?userid=12345&authtoken=${TOKEN}&preset_what=all&preset_time=recentupcoming`;
const DEVICE = 'device-abc12345';

/** An export the way Moodle writes it: CRLF, folded long lines, escaped commas. */
function ics(events: { uid: string; summary: string; start: string; course?: string; params?: string }[]) {
  const body = events
    .map((e) =>
      [
        'BEGIN:VEVENT',
        `UID:${e.uid}@plato.pusan.ac.kr`,
        `SUMMARY:${e.summary}`,
        'DESCRIPTION:Submit on PLATO\\, please.',
        `DTSTART${e.params ?? ''}:${e.start}`,
        `DTEND${e.params ?? ''}:${e.start}`,
        `CATEGORIES:${e.course ?? '운영체제'}`,
        'END:VEVENT',
      ].join('\r\n'),
    )
    .join('\r\n');
  return `BEGIN:VCALENDAR\r\nMETHOD:PUBLISH\r\nPRODID:-//Moodle Pty Ltd//NONSGML Moodle Version 2024042200//EN\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
}

let redis: FakeRedis;
let served: string | { status: number; body?: string };
const fetchMock = vi.fn(async () => {
  if (typeof served === 'string') return new Response(served, { status: 200, headers: { 'Content-Type': 'text/calendar' } });
  return new Response(served.body ?? '', { status: served.status });
});

beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTesting(redis.asRedis());
  process.env.CALENDAR_SECRET = 'c'.repeat(48);
  served = ics([
    { uid: '1', summary: 'OS HW 3 is due', start: '20261126T145900Z' },
    { uid: '2', summary: 'Quiz 2 opens', start: '20261125T010000Z' },
    { uid: '3', summary: '중간 보고서 마감', start: '20261128T235900', params: ';TZID=Asia/Seoul', course: '자료구조' },
  ]);
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  setRedisForTesting(null);
  vi.unstubAllGlobals();
  delete process.env.CALENDAR_SECRET;
});

describe('the link', () => {
  it("accepts PLATO's export link and asks for all events over the next two months", () => {
    expect(normalizeCalendarUrl(`https://plato.pusan.ac.kr/calendar/export_execute.php?userid=12345&authtoken=${TOKEN}&preset_what=courses&preset_time=weeknow`)).toBe(LINK);
    expect(normalizeCalendarUrl(`  http://plato.pusan.ac.kr/calendar/export_execute.php?authtoken=${TOKEN}&userid=12345  `)).toBe(LINK);
  });

  it('refuses anything that could make the server fetch somewhere else', () => {
    for (const bad of [
      `https://evil.example/calendar/export_execute.php?userid=1&authtoken=${TOKEN}`,
      `https://plato.pusan.ac.kr.evil.example/calendar/export_execute.php?userid=1&authtoken=${TOKEN}`,
      `https://plato.pusan.ac.kr@evil.example/calendar/export_execute.php?userid=1&authtoken=${TOKEN}`,
      `https://user:pw@plato.pusan.ac.kr/calendar/export_execute.php?userid=1&authtoken=${TOKEN}`,
      `https://plato.pusan.ac.kr:8443/calendar/export_execute.php?userid=1&authtoken=${TOKEN}`,
      `https://plato.pusan.ac.kr/login/token.php?userid=1&authtoken=${TOKEN}`,
      `https://plato.pusan.ac.kr/calendar/export_execute.php?userid=1;drop&authtoken=${TOKEN}`,
      'https://plato.pusan.ac.kr/calendar/export_execute.php?userid=1&authtoken=short',
      `javascript:alert(1)//plato.pusan.ac.kr/calendar/export_execute.php?userid=1&authtoken=${TOKEN}`,
      42,
    ]) {
      expect(normalizeCalendarUrl(bad)).toBeNull();
    }
  });
});

describe('reading the calendar', () => {
  it('turns events into deadlines, in Korea time, without openings or past events', () => {
    const list = parseCalendar(String(served) + '', T0);
    expect(list.map((d) => [d.title, d.course])).toEqual([
      ['OS HW 3', '운영체제'],
      ['중간 보고서', '자료구조'],
    ]);
    expect(list[0].dueAt).toBe(Date.parse('2026-11-26T14:59:00Z'));
    expect(list[1].dueAt).toBe(Date.parse('2026-11-28T23:59:00+09:00'));
    expect(list[0].id).toMatch(/^platocal_[0-9a-f]{16}$/);
  });

  it('joins folded lines and undoes escapes; all-day events are due at the end of the day', () => {
    const folded = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:9@x\r\nSUMMARY:Very long assignment name\\, part\r\n  two is due\r\nDTSTART;VALUE=DATE:20261130\r\nEND:VEVENT\r\nEND:VCALENDAR';
    const [d] = parseCalendar(folded, T0);
    expect(d.title).toBe('Very long assignment name, part two');
    expect(d.course).toBe('PLATO');
    expect(d.dueAt).toBe(Date.parse('2026-11-30T23:59:00+09:00'));
  });
});

describe('linking', () => {
  it('checks the link with PLATO, stores it encrypted, and gives the device a key', async () => {
    const r = await linkCalendar(DEVICE, LINK, T0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.calendar.deadlines).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(LINK, expect.objectContaining({ redirect: 'manual' }));
    // Nowhere in storage is the link or its token in plain text, nor the device's key.
    const stored = JSON.stringify([...redis.kv.entries()]);
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain('export_execute');
    expect(stored).not.toContain(r.key);
    // The response never carries the link either.
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("refuses a link PLATO doesn't accept (a login page instead of a calendar)", async () => {
    served = { status: 200, body: '<!doctype html><title>PLATO: 로그인</title>' };
    expect(await linkCalendar(DEVICE, LINK, T0)).toEqual({ ok: false, error: 'rejected' });
    // What PLATO really answers for a wrong or old token.
    served = { status: 200, body: 'Invalid authentication' };
    expect(await linkCalendar(DEVICE, LINK, T0)).toEqual({ ok: false, error: 'rejected' });
    served = { status: 303 };
    expect(await linkCalendar(DEVICE, LINK, T0)).toEqual({ ok: false, error: 'rejected' });
    expect(redis.kv.has(CAL_KEYS.entry(DEVICE))).toBe(false);
  });

  it('limits attempts per device', async () => {
    for (let i = 0; i < 10; i++) await linkCalendar(DEVICE, 'nope', T0);
    expect(await linkCalendar(DEVICE, LINK, T0)).toEqual({ ok: false, error: 'too-many-tries' });
  });

  it('only gives the deadlines to the device with the right key, and unlinking deletes everything', async () => {
    const r = await linkCalendar(DEVICE, LINK, T0);
    if (!r.ok) throw new Error('link failed');
    expect(await readCalendar(DEVICE, 'x'.repeat(24), { now: T0 })).toBeNull();
    expect(await readCalendar('device-other123', r.key, { now: T0 })).toBeNull();
    expect((await readCalendar(DEVICE, r.key, { now: T0 }))?.deadlines).toHaveLength(2);

    expect(await unlinkCalendar(DEVICE, 'x'.repeat(24))).toBe(false);
    expect(await unlinkCalendar(DEVICE, r.key)).toBe(true);
    expect(redis.kv.has(CAL_KEYS.entry(DEVICE))).toBe(false);
    expect(redis.sets.get(CAL_KEYS.devices)?.has(DEVICE)).toBe(false);
  });

  it('is off without a server secret', async () => {
    delete process.env.CALENDAR_SECRET;
    delete process.env.OWNER_SECRET;
    expect(await linkCalendar(DEVICE, LINK, T0)).toEqual({ ok: false, error: 'not-configured' });
  });
});

describe('keeping it up to date', () => {
  it('re-reads every 15 minutes and reports what was added since', async () => {
    const r = await linkCalendar(DEVICE, LINK, T0);
    if (!r.ok) throw new Error('link failed');
    fetchMock.mockClear();

    expect((await refreshCalendars(redis.asRedis(), T0 + 5 * MIN)).refreshed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();

    served = ics([
      { uid: '1', summary: 'OS HW 3 is due', start: '20261127T145900Z' }, // moved a day later
      { uid: '4', summary: 'Lab 8 is due', start: '20261201T145900Z' },
    ]);
    const later = T0 + REFRESH_EVERY_MS + MIN;
    const run = await refreshCalendars(redis.asRedis(), later);
    expect(run.refreshed).toBe(1);
    expect(run.added.get(DEVICE)?.map((d) => d.title)).toEqual(['Lab 8']);
    const view = await readCalendar(DEVICE, r.key, { now: later + MIN });
    expect(view?.deadlines.find((d) => d.title === 'OS HW 3')?.dueAt).toBe(Date.parse('2026-11-27T14:59:00Z'));
  });

  it('reminds with PLATO\'s latest dates, skips ones marked done, and adds ones the app has not seen', () => {
    const d = (id: string, dueAt: number, firstSeen: number) => ({ id, title: id, course: 'OS', dueAt, firstSeen });
    const calendar = {
      clientSeenAt: T0,
      deadlines: [d('platocal_moved', T0 + 48 * 60 * MIN, T0 - MIN), d('platocal_done', T0 + 60 * MIN, T0 - MIN), d('platocal_new', T0 + 90 * MIN, T0 + 5 * MIN)],
    };
    const uploaded = [
      { id: 'own_1', title: 'My task', dueDate: T0 + 30 * MIN },
      { id: 'platocal_moved', title: 'old', dueDate: T0 + 24 * 60 * MIN },
      { id: 'platocal_removed', title: 'gone from PLATO', dueDate: T0 + 60 * MIN },
    ];
    const list = withCalendar(uploaded, calendar, T0 + 10 * MIN);
    expect(list.map((t) => [t.id, t.dueDate])).toEqual([
      ['own_1', T0 + 30 * MIN],
      ['platocal_moved', T0 + 48 * 60 * MIN],
      ['platocal_new', T0 + 90 * MIN],
    ]);
  });

  it('marks a link expired after PLATO rejects it three times, and stops asking', async () => {
    const r = await linkCalendar(DEVICE, LINK, T0);
    if (!r.ok) throw new Error('link failed');
    served = { status: 403 };
    let t = T0;
    for (let i = 0; i < 3; i++) {
      t += 8 * REFRESH_EVERY_MS;
      await refreshCalendars(redis.asRedis(), t);
    }
    expect((await readCalendar(DEVICE, r.key, { now: t }))?.error).toBe('expired');
    fetchMock.mockClear();
    await refreshCalendars(redis.asRedis(), t + 10 * REFRESH_EVERY_MS);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
