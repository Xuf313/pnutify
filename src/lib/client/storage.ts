import type { Notice, Task, Theme } from './types';
import { THEMES } from './types';

export const KEYS = {
  deviceId: 'device_id',
  theme: 'theme_v1',
  tasks: 'tasks_v3',
  read: 'notice_read_v3',
  notices: 'notices_cache_v3',
  lastVisit: 'last_visit_v1',
  dismissed: 'dismissed_cards_v1',
  /** Pending first-visit cutoff (a number) until old notices are marked read, then "done". */
  readSeed: 'read_seed_v1',
  /** Owner mode: deleted task ids (so other devices don't bring them back) and PLATO/NESPA done flags. */
  deletedTasks: 'owner_deleted_v1',
  external: 'owner_external_v1',
  isOwner: 'owner_device_v1',
  ownerData: 'owner_data_v1',
} as const;

// Keys from older versions. PLATO credentials were kept here in plain text —
// they are deleted on first load of this version.
const LEGACY = ['plato_creds_v2', 'is_logged_in_v2', 'classes_v2', 'notices_v2', 'tasks_v2'];

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode) — the app still works for this visit.
  }
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(KEYS.deviceId);
    if (!id || !/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
      id = crypto.randomUUID ? crypto.randomUUID() : `dev_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEYS.deviceId, id);
    }
    return id;
  } catch {
    return '';
  }
}

export function loadTheme(): Theme {
  let raw = 'pnu';
  try {
    // Stored as a bare string (not JSON) since the first version.
    raw = (localStorage.getItem(KEYS.theme) || 'pnu').replace(/"/g, '');
  } catch {}
  return (THEMES.some((x) => x.id === raw) ? raw : 'pnu') as Theme;
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEYS.theme, theme);
  } catch {}
}

type LegacyTask = { id?: unknown; title?: unknown; course?: unknown; dueDate?: unknown; status?: unknown; source?: unknown; createdAt?: unknown };
type LegacyNotice = { id?: unknown; status?: unknown; source?: unknown };

function toTask(t: LegacyTask): Task | null {
  const due = typeof t.dueDate === 'number' ? t.dueDate : Date.parse(String(t.dueDate ?? ''));
  if (!t.title || Number.isNaN(due)) return null;
  return {
    id: String(t.id ?? `own_${due}`),
    title: String(t.title),
    course: t.course ? String(t.course) : 'General',
    dueDate: due,
    status: t.status === 'completed' ? 'completed' : 'pending',
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
  };
}

/**
 * One-time upgrade from the old storage layout:
 * - wipes saved PLATO credentials and PLATO data,
 * - keeps the student's own tasks,
 * - keeps which notices were already read.
 */
export function migrateStorage(): void {
  try {
    if (localStorage.getItem(KEYS.tasks) === null) {
      const old = read<LegacyTask[]>('tasks_v2', []);
      const mine = (Array.isArray(old) ? old : []).filter((t) => t && t.source === 'own').map(toTask).filter(Boolean);
      write(KEYS.tasks, mine);
    }
    if (localStorage.getItem(KEYS.read) === null) {
      const old = read<LegacyNotice[]>('notices_v2', []);
      const readIds = (Array.isArray(old) ? old : [])
        .filter((n) => n && n.status === 'read' && n.source !== 'classes')
        .map((n) => String(n.id));
      write(KEYS.read, readIds);
    }
    for (const k of LEGACY) localStorage.removeItem(k);
  } catch {
    // Ignore — worst case the student starts fresh.
  }
}

export function loadTasks(): Task[] {
  const list = read<LegacyTask[]>(KEYS.tasks, []);
  return (Array.isArray(list) ? list : []).map(toTask).filter((t): t is Task => t !== null);
}

export type NoticeCache = { updatedAt: number; notices: Notice[] };
