// Everything in PNUtify is shown in Korea time, whatever the device's timezone.
export const TZ = 'Asia/Seoul';
const DAY = 86_400_000;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** "2026-11-19" for the given instant, in KST. */
export function kstDay(t: number | Date): string {
  const p = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t);
  const get = (type: string) => p.find((x) => x.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function kstHour(t: number | Date): number {
  return Number(fmt({ hour: 'numeric', hourCycle: 'h23' }).format(t));
}

/** Epoch ms for a KST calendar date and time ("2026-11-19", "23:59"). */
export function fromKst(day: string, time = '23:59'): number {
  return Date.parse(`${day}T${time}:00+09:00`);
}

export function startOfKstDay(t: number): number {
  return fromKst(kstDay(t), '00:00');
}

export function addDays(day: string, n: number): string {
  return kstDay(fromKst(day, '12:00') + n * DAY);
}

export const formatDate = (t: number, opts: Intl.DateTimeFormatOptions) => fmt(opts).format(t);

export function formatTime(t: number): string {
  return fmt({ hour: 'numeric', minute: '2-digit' }).format(t);
}

/** "Today 11:59 PM", "Tomorrow 9:00 AM", "Sat 22 Nov, 10:00 PM". */
export function formatDue(t: number, now = Date.now()): string {
  const d = kstDay(t);
  const today = kstDay(now);
  if (d === today) return `Today ${formatTime(t)}`;
  if (d === addDays(today, 1)) return `Tomorrow ${formatTime(t)}`;
  if (d === addDays(today, -1)) return `Yesterday ${formatTime(t)}`;
  return `${formatDate(t, { weekday: 'short', day: 'numeric', month: 'short' })}, ${formatTime(t)}`;
}

/** "in 3 h 20 m", "in 2 days", "2 h ago". */
export function relative(t: number, now = Date.now()): string {
  const diff = t - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  let text: string;
  if (mins < 1) return 'now';
  if (mins < 60) text = `${mins} m`;
  else if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    text = m && h < 6 ? `${h} h ${m} m` : `${h} h`;
  } else {
    const d = Math.round(mins / (24 * 60));
    text = `${d} day${d === 1 ? '' : 's'}`;
  }
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export function greeting(now = Date.now()): string {
  const h = kstHour(now);
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
