/**
 * PLATO (Moodle) client for owner mode. Uses Moodle's mobile web service API
 * (the one the official Moodle app uses) instead of scraping pages: one login
 * returns an access key, and the password is not sent again until that key
 * stops working.
 */

export const PLATO_BASE = 'https://plato.pusan.ac.kr';
const TIMEOUT_MS = 15_000;
const UA = 'Mozilla/5.0 (compatible; PNUtify/2.0; personal use)';
const DAY = 86_400_000;

export type PlatoDeadline = {
  id: string;
  title: string;
  course: string;
  /** Epoch ms. */
  dueAt: number;
  url: string;
  /** Moodle module, e.g. "assign" or "quiz". */
  kind: string;
};

export type PlatoAnnouncement = {
  id: string;
  title: string;
  course: string;
  author: string;
  postedAt: number;
  url: string;
  excerpt: string;
};

export type PlatoData = {
  name: string;
  courses: { id: number; name: string }[];
  deadlines: PlatoDeadline[];
  announcements: PlatoAnnouncement[];
};

/** PLATO said the ID or password is wrong. Never retried automatically, to avoid locking the account. */
export class PlatoLoginError extends Error {}
/** The stored access key no longer works; log in again. */
export class PlatoTokenError extends Error {}

async function post(path: string, form: Record<string, string>): Promise<unknown> {
  const res = await fetch(`${PLATO_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams(form).toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`PLATO answered ${res.status}`);
  return res.json();
}

export async function platoLogin(username: string, password: string): Promise<string> {
  const data = (await post('/login/token.php', { username, password, service: 'moodle_mobile_app' })) as {
    token?: string;
    errorcode?: string;
    error?: string;
  };
  if (data.token) return data.token;
  if (data.errorcode === 'invalidlogin') throw new PlatoLoginError('PLATO rejected the ID or password');
  throw new Error(`PLATO login failed: ${data.errorcode ?? 'unknown'}`);
}

/** Moodle's form encoding: arrays as name[0], objects as name[key]. */
export function flattenParams(params: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') Object.assign(out, flattenParams(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

export async function callPlato<T>(token: string, wsfunction: string, params: Record<string, unknown> = {}): Promise<T> {
  const data = (await post('/webservice/rest/server.php', {
    wstoken: token,
    wsfunction,
    moodlewsrestformat: 'json',
    ...flattenParams(params),
  })) as T & { exception?: string; errorcode?: string; message?: string };
  if (data && typeof data === 'object' && 'exception' in data && data.exception) {
    if (data.errorcode === 'invalidtoken' || data.errorcode === 'accessexception') throw new PlatoTokenError(String(data.errorcode));
    throw new Error(`${wsfunction}: ${data.errorcode ?? data.message ?? 'error'}`);
  }
  return data;
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

type SiteInfo = { userid: number; fullname: string };
type Course = { id: number; fullname: string; shortname?: string; visible?: number; hidden?: boolean; enddate?: number };
type ActionEvent = { id: number; name: string; timesort: number; url?: string; modulename?: string; course?: { id: number; fullname: string } };
type Forum = { id: number; course: number; type: string };
type Discussion = { id: number; discussion: number; name?: string; subject?: string; created?: number; timemodified?: number; userfullname?: string; message?: string };

async function discussions(token: string, forumId: number): Promise<Discussion[]> {
  try {
    const r = await callPlato<{ discussions?: Discussion[] }>(token, 'mod_forum_get_forum_discussions', { forumid: forumId, sortorder: 0, page: 0, perpage: 6 });
    return r.discussions ?? [];
  } catch (e) {
    if (e instanceof PlatoTokenError) throw e;
    // Older Moodle versions only have the paginated call.
    const r = await callPlato<{ discussions?: Discussion[] }>(token, 'mod_forum_get_forum_discussions_paginated', {
      forumid: forumId,
      sortby: 'timemodified',
      sortdirection: 'DESC',
      page: 0,
      perpage: 6,
    });
    return r.discussions ?? [];
  }
}

/** Everything the Briefing needs from PLATO, in a handful of API calls. */
export async function fetchPlato(token: string, now = Date.now()): Promise<PlatoData> {
  const site = await callPlato<SiteInfo>(token, 'core_webservice_get_site_info');
  const allCourses = await callPlato<Course[]>(token, 'core_enrol_get_users_courses', { userid: site.userid });
  // Current courses: visible, and not ended more than two weeks ago.
  const courses = (Array.isArray(allCourses) ? allCourses : [])
    .filter((c) => c.visible !== 0 && !c.hidden && (!c.enddate || c.enddate * 1000 > now - 14 * DAY))
    .map((c) => ({ id: c.id, name: text(c.fullname) }));
  const courseName = new Map(courses.map((c) => [c.id, c.name]));

  // Assignments, quizzes etc. still waiting for action (submitted work drops off by itself).
  const events = await callPlato<{ events?: ActionEvent[] }>(token, 'core_calendar_get_action_events_by_timesort', {
    timesortfrom: Math.floor((now - 3 * DAY) / 1000),
    timesortto: Math.floor((now + 60 * DAY) / 1000),
    limitnum: 50,
    limittononsuspendedevents: 1,
  });
  const deadlines: PlatoDeadline[] = (events.events ?? []).map((e) => ({
    id: `plato_${e.id}`,
    title: text(e.name).replace(/\s*(마감|is due|due)\s*$/i, '') || text(e.name),
    course: e.course ? courseName.get(e.course.id) ?? text(e.course.fullname) : '',
    dueAt: e.timesort * 1000,
    url: e.url || PLATO_BASE,
    kind: e.modulename || 'activity',
  }));

  // Course announcements: the "news" forum of each current course, last 3 weeks.
  let announcements: PlatoAnnouncement[] = [];
  if (courses.length > 0) {
    const forums = await callPlato<Forum[]>(token, 'mod_forum_get_forums_by_courses', { courseids: courses.map((c) => c.id) }).catch((e) => {
      if (e instanceof PlatoTokenError) throw e;
      return [] as Forum[];
    });
    const news = (Array.isArray(forums) ? forums : []).filter((f) => f.type === 'news');
    const lists = await Promise.all(
      news.map((f) =>
        discussions(token, f.id)
          .then((ds) => ds.map((d) => ({ d, course: courseName.get(f.course) ?? '' })))
          .catch((e) => {
            if (e instanceof PlatoTokenError) throw e;
            return [];
          }),
      ),
    );
    announcements = lists
      .flat()
      .map(({ d, course }) => ({
        id: `platonews_${d.discussion || d.id}`,
        title: text(d.name || d.subject || ''),
        course,
        author: d.userfullname ?? '',
        postedAt: (d.created || d.timemodified || 0) * 1000,
        url: `${PLATO_BASE}/mod/forum/discuss.php?d=${d.discussion || d.id}`,
        excerpt: text(d.message ?? '').slice(0, 160),
      }))
      .filter((a) => a.title && a.postedAt > now - 21 * DAY)
      .sort((a, b) => b.postedAt - a.postedAt)
      .slice(0, 20);
  }

  return { name: text(site.fullname), courses, deadlines: deadlines.sort((a, b) => a.dueAt - b.dueAt), announcements };
}
