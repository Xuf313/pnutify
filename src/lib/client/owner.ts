import type { CoursePost, OwnerData, Task } from './types';
import { getDeviceId } from './storage';

/** Owner mode: everything returns null for anyone who isn't signed in as the owner. */

/** The owner's data; "not-owner" when the server says this device isn't signed in; null if offline. */
export async function fetchOwnerData(): Promise<OwnerData | 'not-owner' | null> {
  try {
    const res = await fetch('/api/owner/data', { cache: 'no-store', credentials: 'same-origin' });
    if (res.status === 401) return 'not-owner';
    if (!res.ok) return null;
    const body = await res.json();
    return body?.owner ? ((body.data as OwnerData) ?? null) : 'not-owner';
  } catch {
    return null;
  }
}

/** "Sync now". Returns the data and whether the server skipped it (once a minute at most). */
export async function syncOwnerNow(): Promise<{ data: OwnerData | null; throttled: boolean }> {
  const res = await fetch('/api/owner/data', { method: 'POST', credentials: 'same-origin' });
  if (!res.ok) return { data: null, throttled: false };
  const body = await res.json();
  return { data: body?.data ?? null, throttled: Boolean(body?.throttled) };
}

export async function unlockOwner(key: string): Promise<'ok' | 'wrong-key' | 'locked' | 'not-configured' | 'error'> {
  try {
    const res = await fetch('/api/owner/unlock', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, deviceId: getDeviceId() }),
    });
    if (res.ok) return 'ok';
    const body = await res.json().catch(() => ({}));
    return ['wrong-key', 'locked', 'not-configured'].includes(body?.reason) ? body.reason : 'error';
  } catch {
    return 'error';
  }
}

export async function lockOwner(): Promise<void> {
  await fetch(`/api/owner/unlock?deviceId=${encodeURIComponent(getDeviceId())}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
}

export type SyncState = {
  tasks: Task[];
  deleted: Record<string, number>;
  readIds: string[];
  external: Record<string, { done: boolean; at: number }>;
};

/** Sends this device's copy; the server merges it with the other devices' and returns the result. */
export async function pushOwnerState(state: SyncState): Promise<SyncState | null> {
  try {
    const res = await fetch('/api/owner/state', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { ...state, tasks: state.tasks.filter((t) => !t.source || t.source === 'own') } }),
    });
    if (!res.ok) return null;
    return ((await res.json())?.state as SyncState) ?? null;
  } catch {
    return null;
  }
}

/** PLATO deadlines and NESPA assignments as read-only tasks. */
export function externalTasks(d: OwnerData | null, external: SyncState['external'], now: number): Task[] {
  if (!d) return [];
  const done = (id: string) => external[id]?.done === true;
  const plato: Task[] = (d.plato.data?.deadlines ?? []).map((x) => ({
    id: x.id,
    title: x.title,
    course: x.course || 'PLATO',
    dueDate: x.dueAt,
    status: done(x.id) ? 'completed' : 'pending',
    createdAt: x.dueAt,
    source: 'plato',
    url: x.url,
  }));
  const nespa: Task[] = (d.nespa.data?.assignments ?? [])
    .filter((a) => a.dueAt !== null && (a.dueAt > now - 7 * 86_400_000 || a.score))
    .map((a) => ({
      id: a.id,
      title: a.score ? `${a.title} (score ${a.score})` : a.title,
      course: 'NESPA',
      dueDate: a.dueAt as number,
      // A score means it was submitted and graded.
      status: a.score || done(a.id) ? 'completed' : 'pending',
      createdAt: a.opensAt ?? (a.dueAt as number),
      source: 'nespa',
      url: a.url,
    }));
  return [...plato, ...nespa];
}

export function coursePosts(d: OwnerData | null): CoursePost[] {
  if (!d) return [];
  const plato: CoursePost[] = (d.plato.data?.announcements ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    source: 'PLATO',
    course: a.course,
    postedAt: a.postedAt,
    url: a.url,
    excerpt: a.excerpt,
  }));
  const nespa: CoursePost[] = (d.nespa.data?.notices ?? []).map((n) => ({ id: n.id, title: n.title, source: 'NESPA', course: 'NESPA', postedAt: n.postedAt, url: n.url }));
  return [...plato, ...nespa].sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
}
