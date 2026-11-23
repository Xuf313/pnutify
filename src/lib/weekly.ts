/**
 * The weekly preview: on Sunday evening (Korea time), one alert listing the
 * coming week's deadlines, Monday to Sunday.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KST = 9 * HOUR;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Sent from this hour (KST) on Sunday until midnight. */
export const WEEKLY_HOUR = 20;

export type WeekWindow = {
  /** The Monday the week starts, e.g. "2026-11-30". Used to send once per week. */
  weekKey: string;
  from: number;
  to: number;
};

const kstDate = (t: number) => new Date(t + KST).toISOString().slice(0, 10);

/** The week to preview, if it's Sunday evening in Korea; otherwise null. */
export function weeklyWindow(now: number): WeekWindow | null {
  const k = new Date(now + KST);
  if (k.getUTCDay() !== 0 || k.getUTCHours() < WEEKLY_HOUR) return null;
  const monday = Date.parse(`${kstDate(now)}T00:00:00+09:00`) + DAY;
  return { weekKey: kstDate(monday), from: monday, to: monday + 7 * DAY };
}

type Due = { title: string; dueDate: number };

/** "Your week: 3 deadlines" with "Mon: A · Wed: B, C" (or a quiet-week message). */
export function weeklyMessage(tasks: Due[], win: WeekWindow): { title: string; body: string } {
  const due = tasks.filter((t) => t.dueDate >= win.from && t.dueDate < win.to).sort((a, b) => a.dueDate - b.dueDate);
  if (due.length === 0) return { title: 'Your week: nothing due', body: 'No deadlines from Monday to Sunday. Enjoy it!' };

  const byDay = new Map<string, string[]>();
  for (const t of due) {
    const day = DAYS[new Date(t.dueDate + KST).getUTCDay()];
    byDay.set(day, [...(byDay.get(day) ?? []), t.title]);
  }
  let body = [...byDay].map(([day, titles]) => `${day}: ${titles.join(', ')}`).join(' · ');
  if (body.length > 170) body = `${body.slice(0, 169).trimEnd()}…`;
  return { title: `Your week: ${due.length} deadline${due.length === 1 ? '' : 's'}`, body };
}
