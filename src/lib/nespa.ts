import * as cheerio from 'cheerio';

/**
 * NESPA (the Data Structures course's assignment site) for owner mode.
 * The assignment list and the notice board are public; logging in only adds
 * the owner's scores to the assignment list.
 */

export const NESPA_BASE = 'https://emerald.pusan.ac.kr';
const ROOT = '/ds2026';
const TIMEOUT_MS = 15_000;
const UA = 'Mozilla/5.0 (compatible; PNUtify/2.0; personal use)';
const DAY = 86_400_000;

export type NespaAssignment = {
  id: string;
  no: number;
  title: string;
  opensAt: number | null;
  dueAt: number | null;
  /** The score column as shown, only when logged in (e.g. "100"); null otherwise. */
  score: string | null;
  url: string;
};

export type NespaNotice = { id: string; title: string; author: string; postedAt: number | null; url: string };

export type NespaData = { assignments: NespaAssignment[]; notices: NespaNotice[]; loggedIn: boolean };

export class NespaLoginError extends Error {}

/** "11/24 22:00" (no year, KST) → epoch ms, picking the year that puts it closest to now. */
export function parseNespaDate(textIn: string, now = Date.now()): number | null {
  const m = textIn.trim().match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, mo, d, h, mi] = m;
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(now));
  const at = (y: number) => Date.parse(`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:00+09:00`);
  const candidates = [year - 1, year, year + 1].map(at).filter((t) => !Number.isNaN(t));
  if (candidates.length === 0) return null;
  return candidates.reduce((best, t) => (Math.abs(t - now) < Math.abs(best - now) ? t : best));
}

export function parseSubmissionList(html: string, now = Date.now()): NespaAssignment[] {
  const $ = cheerio.load(html);
  const out: NespaAssignment[] = [];
  $('table tbody tr').each((_, tr) => {
    const cells = $(tr).find('th, td').map((__, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
    if (cells.length < 9) return;
    const no = Number(cells[0]);
    if (!Number.isFinite(no) || !cells[1]) return;
    const detail = $(tr).find('a[href*="submission_detail"]').attr('href');
    out.push({
      id: `nespa_${no}`,
      no,
      title: cells[1],
      opensAt: parseNespaDate(cells[6], now),
      dueAt: parseNespaDate(cells[7], now),
      score: cells[8] ? cells[8] : null,
      url: detail ? new URL(detail, NESPA_BASE).toString() : `${NESPA_BASE}${ROOT}/submission_list/`,
    });
  });
  return out;
}

export function parseNoticeBoard(html: string): NespaNotice[] {
  const $ = cheerio.load(html);
  const out: NespaNotice[] = [];
  $('#board_list_table tbody tr, table tbody tr').each((_, tr) => {
    const $tr = $(tr);
    const link = $tr.find('td.table_title a').first();
    const href = link.attr('href');
    if (!href) return;
    // Each title link carries a small script with the exact post time:
    // Date.parse(`<now>`) < Date.parse(`<posted>`) + 259200000
    const script = link.find('script').text();
    const posted = script.match(/Date\.parse\(`([^`]+)`\)\)\s*\+/);
    const iso = posted ? posted[1].replace(/\.\d+$/, '') : null;
    const $title = link.clone();
    $title.find('script, span').remove();
    const title = $title.text().replace(/\s+/g, ' ').trim();
    const id = href.match(/\/post\/(\d+)/)?.[1];
    if (!title || !id || out.some((n) => n.id === `nespanotice_${id}`)) return;
    out.push({
      id: `nespanotice_${id}`,
      title,
      author: $tr.find('td.table_author').first().text().trim(),
      postedAt: iso ? Date.parse(`${iso}+09:00`) || null : null,
      url: new URL(href, NESPA_BASE).toString(),
    });
  });
  return out;
}

type Jar = Record<string, string>;
const jarHeader = (jar: Jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
function absorb(jar: Jar, res: Response) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(/^([^=;]+)=([^;]*)/);
    if (m) jar[m[1].trim()] = m[2].trim();
  }
}

async function get(path: string, jar: Jar = {}): Promise<{ html: string; res: Response }> {
  const res = await fetch(`${NESPA_BASE}${path}`, {
    headers: { 'User-Agent': UA, ...(Object.keys(jar).length ? { Cookie: jarHeader(jar) } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  absorb(jar, res);
  if (!res.ok) throw new Error(`NESPA answered ${res.status}`);
  return { html: await res.text(), res };
}

/** Logs in to NESPA (a Django site) and returns the session cookies. */
export async function nespaLogin(userId: string, password: string): Promise<Jar> {
  const jar: Jar = {};
  const { html } = await get(`${ROOT}/login/`, jar);
  const csrf = cheerio.load(html)('input[name="csrfmiddlewaretoken"]').attr('value') ?? '';
  const res = await fetch(`${NESPA_BASE}${ROOT}/login/`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jarHeader(jar),
      Referer: `${NESPA_BASE}${ROOT}/login/`,
      Origin: NESPA_BASE,
    },
    body: new URLSearchParams({ csrfmiddlewaretoken: csrf, user_id: userId, password }).toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  absorb(jar, res);
  // Django redirects after a good login and sets a session cookie; a bad one re-shows the form.
  if (res.status >= 300 && res.status < 400 && Object.keys(jar).some((k) => /session/i.test(k))) return jar;
  if (res.status === 200) throw new NespaLoginError('NESPA rejected the ID or password');
  throw new Error(`NESPA login failed: ${res.status}`);
}

const loggedInPage = (html: string) => /logout/i.test(html);

/**
 * Public data, plus scores when a session is given. Returns the session
 * actually used (null if it had expired), so the caller can log in again.
 */
export async function fetchNespa(session: Jar | null, now = Date.now()): Promise<NespaData & { sessionValid: boolean }> {
  const jar = { ...(session ?? {}) };
  const [subs, board] = await Promise.all([get(`${ROOT}/submission_list/`, jar), get(`${ROOT}/board/notice`)]);
  const sessionValid = session !== null && loggedInPage(subs.html);
  const assignments = parseSubmissionList(subs.html, now).filter((a) => a.dueAt === null || a.dueAt > now - 45 * DAY);
  const notices = parseNoticeBoard(board.html).slice(0, 15);
  return { assignments, notices, loggedIn: sessionValid, sessionValid };
}
