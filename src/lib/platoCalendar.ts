import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Redis } from '@upstash/redis';
import { getRedis, isValidDeviceId } from './redis';

/**
 * PLATO deadlines for every student, without passwords.
 *
 * PLATO (Moodle) lets each student export their calendar as a private link
 * (Calendar → 달력 내보냄 → 달력 URL 가져옴). The link can only read calendar
 * events: no login, grades, messages or submissions. A student pastes it once;
 * the server keeps it encrypted, re-reads it every ~15 minutes, and the app
 * shows the deadlines as read-only PLATO tasks with the usual reminders.
 *
 * The link is never sent back to any browser and never logged. Each device
 * gets a random key at link time and needs it to read its deadlines.
 */

export const PLATO_HOST = 'plato.pusan.ac.kr';
const EXPORT_PATH = '/calendar/export_execute.php';
/** Where a calendar deadline opens in PLATO (the export has no per-event links). */
export const PLATO_UPCOMING_URL = `https://${PLATO_HOST}/calendar/view.php?view=upcoming`;

export const REFRESH_EVERY_MS = 15 * 60 * 1000;
/** Students who haven't opened the app for a week are checked less often. */
export const IDLE_REFRESH_EVERY_MS = 2 * 60 * 60 * 1000;
const IDLE_AFTER_MS = 7 * 86_400_000;
/** Calendars read per cron run, a few at a time, so a big class never means a burst of requests to PLATO. */
export const MAX_REFRESH_PER_RUN = 12;
/** A link PLATO rejects this many times in a row is treated as expired (password changed). */
const EXPIRED_AFTER = 3;
/** A "Refresh now" from the app is honoured at most this often. */
const MANUAL_REFRESH_GAP_MS = 2 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const LINK_ATTEMPTS_PER_HOUR = 10;

export const CAL_KEYS = {
  entry: (deviceId: string) => `platocal:${deviceId}`,
  devices: 'platocal:devices',
  attempts: (deviceId: string) => `platocal:attempts:${deviceId}`,
} as const;

export type CalendarDeadline = {
  id: string;
  title: string;
  course: string;
  dueAt: number;
  /** When PNUtify first saw it. */
  firstSeen: number;
};

type Entry = {
  /** sha256 of the device's key. */
  keyHash: string;
  /** The export link, AES-256-GCM. */
  link: string;
  deadlines: CalendarDeadline[];
  linkedAt: number;
  checkedAt: number;
  okAt: number;
  /** "expired": PLATO rejects the link (usually after a password change). "unreachable": PLATO didn't answer. */
  error: 'expired' | 'unreachable' | null;
  failures: number;
  /** Last time the app read its deadlines; anything first seen after this, the app hasn't uploaded yet. */
  clientSeenAt: number;
};

/** What the app gets back. Never the link. */
export type CalendarView = { deadlines: CalendarDeadline[]; checkedAt: number; okAt: number; error: Entry['error'] };

// ---------- the link ----------

/**
 * Accepts only PLATO's own calendar export link and rebuilds it from its two
 * parameters, so nothing else (another host, path, credentials in the URL)
 * can ever be fetched. Asks for all events over the coming two months.
 */
export function normalizeCalendarUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 600) return null;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.hostname !== PLATO_HOST || u.username || u.password || u.port) return null;
  if (u.pathname !== EXPORT_PATH) return null;
  const userid = u.searchParams.get('userid') ?? '';
  const token = u.searchParams.get('authtoken') ?? '';
  if (!/^\d{1,12}$/.test(userid) || !/^[0-9A-Za-z]{20,128}$/.test(token)) return null;
  return `https://${PLATO_HOST}${EXPORT_PATH}?userid=${userid}&authtoken=${token}&preset_what=all&preset_time=recentupcoming`;
}

// ---------- reading the calendar (iCalendar) ----------

const unescapeText = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();

/** "20261126T145900Z", "20261126T235900" (Korea time) or "20261126" (all day: end of that day, Korea time). */
function parseIcsDate(value: string, params: string): number | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || /VALUE=DATE(?!-)/i.test(params)) return Date.parse(`${y}-${mo}-${d}T23:59:00+09:00`);
  const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : '+09:00'}`);
  return Number.isNaN(t) ? null : t;
}

/** Moodle titles end in what happens ("… is due", "… 마감"). Openings aren't deadlines. */
const OPENING = /(\bopens|\bis open|시작|열림|오픈)$/i;
const DEADLINE_SUFFIX = /\s*(is due|closes|is closing|due|마감(일)?|종료|까지)$/i;

/**
 * The events in an exported calendar, as deadlines from `since` on. Moodle
 * wraps long lines (a line starting with a space continues the last one).
 */
export function parseCalendar(ics: string, since: number): Omit<CalendarDeadline, 'firstSeen'>[] {
  const lines = ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out: Omit<CalendarDeadline, 'firstSeen'>[] = [];
  let ev: Record<string, { value: string; params: string }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') ev = {};
    else if (line === 'END:VEVENT' && ev) {
      const uid = ev.UID?.value;
      const summary = unescapeText(ev.SUMMARY?.value ?? '');
      const at = ev.DTSTART ? parseIcsDate(ev.DTSTART.value, ev.DTSTART.params) : null;
      if (uid && summary && at !== null && at >= since && !OPENING.test(summary)) {
        out.push({
          id: `platocal_${createHash('sha1').update(uid).digest('hex').slice(0, 16)}`,
          title: summary.replace(DEADLINE_SUFFIX, '').trim().slice(0, 200) || summary.slice(0, 200),
          course: unescapeText(ev.CATEGORIES?.value ?? '').slice(0, 80) || 'PLATO',
          dueAt: at,
        });
      }
      ev = null;
    } else if (ev) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
      if (m && !(m[1] in ev)) ev[m[1]] = { value: m[3], params: m[2] };
    }
  }
  const seen = new Set<string>();
  return out.filter((d) => !seen.has(d.id) && seen.add(d.id)).sort((a, b) => a.dueAt - b.dueAt).slice(0, 200);
}

type FetchResult = { ok: true; ics: string } | { ok: false; error: 'expired' | 'unreachable' };

/** Reads the export. A login page, a redirect or an error status means PLATO no longer accepts the link. */
export async function fetchCalendar(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'PNUtify (calendar sync)', Accept: 'text/calendar' },
    });
    if (res.status >= 300 && res.status < 500) return { ok: false, error: 'expired' };
    if (!res.ok || !res.body) return { ok: false, error: 'unreachable' };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return { ok: false, error: 'unreachable' };
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return text.trimStart().startsWith('BEGIN:VCALENDAR') ? { ok: true, ics: text } : { ok: false, error: 'expired' };
  } catch {
    return { ok: false, error: 'unreachable' };
  }
}

// ---------- encryption at rest ----------

function secret(): string | null {
  const s = process.env.CALENDAR_SECRET || process.env.OWNER_SECRET;
  return s && s.length >= 32 ? s : null;
}
export const calendarConfigured = () => Boolean(secret() && getRedis());

function boxKey(): Buffer {
  const s = secret();
  if (!s) throw new Error('calendar-not-configured');
  return createHash('sha256').update(`${s}:pnutify-plato-calendar-v1`).digest();
}
function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', boxKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}
function unseal(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', boxKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const hashKey = (key: string) => createHash('sha256').update(`pnutify-calendar-key:${key}`).digest('hex');
function keyMatches(entry: Entry, key: unknown): boolean {
  if (typeof key !== 'string' || key.length < 20 || key.length > 64) return false;
  const a = Buffer.from(entry.keyHash, 'hex');
  const b = Buffer.from(hashKey(key), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const view = (e: Entry): CalendarView => ({ deadlines: e.deadlines, checkedAt: e.checkedAt, okAt: e.okAt, error: e.error });

/** New deadlines keep the time they were first seen; known ones keep theirs. */
function merge(previous: CalendarDeadline[], found: Omit<CalendarDeadline, 'firstSeen'>[], now: number): CalendarDeadline[] {
  const before = new Map(previous.map((d) => [d.id, d.firstSeen]));
  return found.map((d) => ({ ...d, firstSeen: before.get(d.id) ?? now }));
}

// ---------- link, read, unlink (the app) ----------

export type LinkResult =
  | { ok: true; key: string; calendar: CalendarView }
  | { ok: false; error: 'not-configured' | 'invalid-device' | 'invalid-link' | 'rejected' | 'unreachable' | 'too-many-tries' };

export async function linkCalendar(deviceId: unknown, url: unknown, now = Date.now()): Promise<LinkResult> {
  const redis = getRedis();
  if (!redis || !secret()) return { ok: false, error: 'not-configured' };
  if (!isValidDeviceId(deviceId)) return { ok: false, error: 'invalid-device' };
  const tries = Number(await redis.get<number>(CAL_KEYS.attempts(deviceId))) || 0;
  if (tries >= LINK_ATTEMPTS_PER_HOUR) return { ok: false, error: 'too-many-tries' };
  await redis.set(CAL_KEYS.attempts(deviceId), tries + 1, { ex: 3600 });

  const link = normalizeCalendarUrl(url);
  if (!link) return { ok: false, error: 'invalid-link' };
  const got = await fetchCalendar(link);
  if (!got.ok) return { ok: false, error: got.error === 'expired' ? 'rejected' : 'unreachable' };

  const key = randomBytes(18).toString('base64url');
  const entry: Entry = {
    keyHash: hashKey(key),
    link: seal(link),
    deadlines: merge([], parseCalendar(got.ics, now - 86_400_000), now),
    linkedAt: now,
    checkedAt: now,
    okAt: now,
    error: null,
    failures: 0,
    clientSeenAt: now,
  };
  await redis.set(CAL_KEYS.entry(deviceId), entry);
  await redis.sadd(CAL_KEYS.devices, deviceId);
  return { ok: true, key, calendar: view(entry) };
}

/** The device's deadlines, if the key matches. `refresh` re-reads PLATO first (at most every 2 minutes). */
export async function readCalendar(deviceId: unknown, key: unknown, opts: { refresh?: boolean; now?: number } = {}): Promise<CalendarView | null> {
  const now = opts.now ?? Date.now();
  const redis = getRedis();
  if (!redis || !secret() || !isValidDeviceId(deviceId)) return null;
  let entry = await redis.get<Entry>(CAL_KEYS.entry(deviceId));
  if (!entry || !keyMatches(entry, key)) return null;
  if (opts.refresh && now - entry.checkedAt >= MANUAL_REFRESH_GAP_MS) entry = (await refreshEntry(entry, now)).entry;
  entry = { ...entry, clientSeenAt: now };
  await redis.set(CAL_KEYS.entry(deviceId), entry);
  return view(entry);
}

export async function unlinkCalendar(deviceId: unknown, key: unknown): Promise<boolean> {
  const redis = getRedis();
  if (!redis || !isValidDeviceId(deviceId)) return false;
  const entry = await redis.get<Entry>(CAL_KEYS.entry(deviceId));
  if (!entry || !keyMatches(entry, key)) return false;
  await Promise.all([redis.del(CAL_KEYS.entry(deviceId)), redis.srem(CAL_KEYS.devices, deviceId)]);
  return true;
}

// ---------- the cron ----------

async function refreshEntry(entry: Entry, now: number): Promise<{ entry: Entry; added: CalendarDeadline[] }> {
  const link = unseal(entry.link);
  const got = link ? await fetchCalendar(link) : ({ ok: false, error: 'expired' } as const);
  if (!got.ok) {
    const failures = entry.failures + 1;
    return { entry: { ...entry, checkedAt: now, failures, error: got.error === 'expired' && failures >= EXPIRED_AFTER ? 'expired' : got.error }, added: [] };
  }
  const deadlines = merge(entry.deadlines, parseCalendar(got.ics, now - 86_400_000), now);
  const known = new Set(entry.deadlines.map((d) => d.id));
  const added = deadlines.filter((d) => !known.has(d.id) && d.dueAt > now);
  return { entry: { ...entry, deadlines, checkedAt: now, okAt: now, failures: 0, error: null }, added };
}

const due = (e: Entry, now: number) =>
  e.error !== 'expired' &&
  now - e.checkedAt >= (now - e.clientSeenAt > IDLE_AFTER_MS ? IDLE_REFRESH_EVERY_MS : REFRESH_EVERY_MS) * Math.min(8, 2 ** Math.max(0, e.failures - 1));

export type CalendarRefresh = {
  /** Every linked device's current deadlines, and when its app last read them. */
  current: Map<string, { deadlines: CalendarDeadline[]; clientSeenAt: number }>;
  /** Deadlines that appeared in this run, per device. */
  added: Map<string, CalendarDeadline[]>;
  refreshed: number;
};

/** Re-reads the calendars that are due, oldest first, a few at a time. */
export async function refreshCalendars(redis: Redis, now: number, limit = MAX_REFRESH_PER_RUN): Promise<CalendarRefresh> {
  const result: CalendarRefresh = { current: new Map(), added: new Map(), refreshed: 0 };
  if (!secret()) return result;
  const devices = ((await redis.smembers(CAL_KEYS.devices).catch(() => [])) as string[]).filter(isValidDeviceId);
  if (devices.length === 0) return result;
  const entries = await redis.mget<(Entry | null)[]>(...devices.map(CAL_KEYS.entry));
  const gone = devices.filter((_, i) => !entries[i]);
  if (gone.length > 0) await redis.srem(CAL_KEYS.devices, ...gone);

  const live = devices.map((id, i) => [id, entries[i]] as const).filter((x): x is readonly [string, Entry] => Boolean(x[1]));
  const toRefresh = live.filter(([, e]) => due(e, now)).sort((a, b) => a[1].checkedAt - b[1].checkedAt).slice(0, limit);
  const updated = new Map<string, Entry>();
  for (let i = 0; i < toRefresh.length; i += 4) {
    const chunk = toRefresh.slice(i, i + 4);
    const done = await Promise.all(chunk.map(([, e]) => refreshEntry(e, now)));
    done.forEach((r, j) => {
      const id = chunk[j][0];
      updated.set(id, r.entry);
      if (r.added.length > 0) result.added.set(id, r.added);
    });
  }
  for (const [id, e] of updated) await redis.set(CAL_KEYS.entry(id), e);
  result.refreshed = updated.size;

  for (const [id, e] of live) {
    const entry = updated.get(id) ?? e;
    if (entry.error !== 'expired') result.current.set(id, { deadlines: entry.deadlines, clientSeenAt: entry.clientSeenAt });
  }
  return result;
}

type Remindable = { id: string; title: string; course?: string; dueDate: number | string };

/**
 * The deadlines to remind a device about, given what its app last uploaded
 * and its calendar as PLATO has it now:
 * - calendar items the app uploaded take PLATO's current title and date (a
 *   moved deadline moves its reminder), and drop out if PLATO removed them;
 * - calendar items the app has seen but didn't upload were marked done there;
 * - calendar items the app hasn't seen yet are added.
 */
export function withCalendar<T extends Remindable>(uploaded: T[], calendar: CalendarRefresh['current'] extends Map<string, infer V> ? V | undefined : never, now: number): (T | Remindable)[] {
  if (!calendar) return uploaded;
  const fresh = new Map(calendar.deadlines.map((d) => [d.id, d]));
  const kept = uploaded
    .filter((t) => !t.id.startsWith('platocal_') || fresh.has(t.id))
    .map((t) => {
      const d = fresh.get(t.id);
      return d ? { ...t, title: d.title, course: d.course, dueDate: d.dueAt } : t;
    });
  const ids = new Set(kept.map((t) => t.id));
  const unseen = calendar.deadlines
    .filter((d) => !ids.has(d.id) && d.firstSeen > calendar.clientSeenAt && d.dueAt > now)
    .map((d) => ({ id: d.id, title: d.title, course: d.course, dueDate: d.dueAt }));
  return [...kept, ...unseen];
}
