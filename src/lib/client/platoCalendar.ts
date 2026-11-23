import { getDeviceId, KEYS, read, write } from './storage';
import type { SyncState } from './owner';
import type { Task } from './types';

/**
 * PLATO deadlines from the student's own calendar link (see src/lib/platoCalendar.ts).
 * This device keeps only its key; the link itself is never kept in the browser
 * after linking.
 */

export type CalendarDeadline = { id: string; title: string; course: string; dueAt: number; firstSeen: number };
export type CalendarView = { deadlines: CalendarDeadline[]; checkedAt: number; okAt: number; error: 'expired' | 'unreachable' | null };
export type LinkError = 'not-configured' | 'invalid-link' | 'rejected' | 'unreachable' | 'too-many-tries' | 'error';

export const PLATO_EXPORT_PAGE = 'https://plato.pusan.ac.kr/calendar/export.php';
const PLATO_UPCOMING = 'https://plato.pusan.ac.kr/calendar/view.php?view=upcoming';

export const calendarKey = () => read<string | null>(KEYS.platoCalendarKey, null);
export const cachedCalendar = () => read<CalendarView | null>(KEYS.platoCalendar, null);

export async function linkCalendar(url: string): Promise<{ ok: true; calendar: CalendarView } | { ok: false; error: LinkError }> {
  try {
    const res = await fetch('/api/plato-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), url }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.key) return { ok: false, error: (data?.error as LinkError) ?? 'error' };
    write(KEYS.platoCalendarKey, data.key);
    write(KEYS.platoCalendar, data.calendar);
    return { ok: true, calendar: data.calendar as CalendarView };
  } catch {
    return { ok: false, error: 'error' };
  }
}

/** The latest deadlines; null if this device isn't linked (or the link was removed elsewhere). */
export async function loadCalendar(refresh = false): Promise<CalendarView | null | 'offline'> {
  const key = calendarKey();
  if (!key) return null;
  try {
    const res = await fetch(`/api/plato-calendar?deviceId=${encodeURIComponent(getDeviceId())}${refresh ? '&refresh=1' : ''}`, {
      headers: { 'x-calendar-key': key },
      cache: 'no-store',
    });
    if (res.status === 404) {
      forgetCalendar();
      return null;
    }
    if (!res.ok) return 'offline';
    const view = (await res.json())?.calendar as CalendarView;
    write(KEYS.platoCalendar, view);
    return view;
  } catch {
    return 'offline';
  }
}

export async function unlinkCalendar(): Promise<void> {
  const key = calendarKey();
  if (key) {
    await fetch(`/api/plato-calendar?deviceId=${encodeURIComponent(getDeviceId())}`, { method: 'DELETE', headers: { 'x-calendar-key': key } }).catch(() => null);
  }
  forgetCalendar();
}

function forgetCalendar() {
  write(KEYS.platoCalendarKey, null);
  write(KEYS.platoCalendar, null);
}

/** Calendar deadlines as read-only PLATO tasks; ticked-off and cleared ones follow the synced done flags. */
export function calendarTasks(view: CalendarView | null, external: SyncState['external'], now: number): Task[] {
  if (!view) return [];
  return view.deadlines
    .filter((d) => !external[d.id]?.cleared && (d.dueAt > now - 7 * 86_400_000 || external[d.id]?.done))
    .map((d) => ({
      id: d.id,
      title: d.title,
      course: d.course,
      dueDate: d.dueAt,
      status: external[d.id]?.done ? 'completed' : 'pending',
      createdAt: d.firstSeen,
      source: 'plato',
      url: PLATO_UPCOMING,
    }));
}
