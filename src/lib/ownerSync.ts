import type { Redis } from '@upstash/redis';
import { getRedis, withLock } from './redis';
import { nespaConfigured, OWNER_KEYS, ownerEnabled, platoConfigured, seal, unseal } from './owner';
import { fetchPlato, platoLogin, PlatoLoginError, PlatoTokenError, type PlatoData } from './plato';
import { fetchNespa, nespaLogin, NespaLoginError, type NespaData } from './nespa';

/** PLATO and NESPA are re-read at most this often (cron), or on request from an owner device. */
export const OWNER_SYNC_EVERY_MS = 20 * 60 * 1000;
/** After a rejected password, don't try that login again for this long: repeated failures can lock the account. */
const LOGIN_BACKOFF_MS = 6 * 60 * 60 * 1000;

type SourceState<T> = {
  configured: boolean;
  ok: boolean;
  error?: string;
  data?: T;
  /** When data was last read successfully. */
  syncedAt?: number;
  loginBlockedUntil?: number;
};

export type OwnerData = {
  checkedAt: number;
  plato: SourceState<PlatoData>;
  nespa: SourceState<NespaData>;
};

export async function getOwnerData(): Promise<OwnerData | null> {
  const redis = getRedis();
  if (!redis) return null;
  return (await redis.get<OwnerData>(OWNER_KEYS.data).catch(() => null)) ?? null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'Unknown error').slice(0, 200);

async function syncPlato(redis: Redis, now: number, prev: SourceState<PlatoData> | undefined): Promise<SourceState<PlatoData>> {
  if (!platoConfigured()) return { configured: false, ok: false };
  const kept = { configured: true, data: prev?.data, syncedAt: prev?.syncedAt };
  if (prev?.loginBlockedUntil && prev.loginBlockedUntil > now) {
    return { ...kept, ok: false, error: prev.error, loginBlockedUntil: prev.loginBlockedUntil };
  }
  const login = async () => {
    const token = await platoLogin(process.env.PLATO_ID!, process.env.PLATO_PW!);
    await redis.set(OWNER_KEYS.platoToken, seal(token));
    return token;
  };
  try {
    let token = unseal(await redis.get<string>(OWNER_KEYS.platoToken)) ?? (await login());
    let data: PlatoData;
    try {
      data = await fetchPlato(token, now);
    } catch (e) {
      if (!(e instanceof PlatoTokenError)) throw e;
      token = await login();
      data = await fetchPlato(token, now);
    }
    return { configured: true, ok: true, data, syncedAt: now };
  } catch (e) {
    if (e instanceof PlatoLoginError) {
      await redis.del(OWNER_KEYS.platoToken);
      return {
        ...kept,
        ok: false,
        error: 'PLATO rejected PLATO_ID / PLATO_PW. Fix them in Vercel; PNUtify waits 6 hours before trying again.',
        loginBlockedUntil: now + LOGIN_BACKOFF_MS,
      };
    }
    return { ...kept, ok: false, error: `Couldn't read PLATO: ${message(e)}` };
  }
}

async function syncNespa(redis: Redis, now: number, prev: SourceState<NespaData> | undefined): Promise<SourceState<NespaData>> {
  if (!nespaConfigured()) return { configured: false, ok: false };
  const kept = { configured: true, data: prev?.data, syncedAt: prev?.syncedAt };
  const blocked = Boolean(prev?.loginBlockedUntil && prev.loginBlockedUntil > now);
  const login = async () => {
    const jar = await nespaLogin(process.env.NESPA_ID!, process.env.NESPA_PW!);
    await redis.set(OWNER_KEYS.nespaSession, seal(JSON.stringify(jar)), { ex: 7 * 86_400 });
    return jar;
  };
  try {
    const stored = unseal(await redis.get<string>(OWNER_KEYS.nespaSession));
    let session: Record<string, string> | null = stored ? (JSON.parse(stored) as Record<string, string>) : null;
    let loginError: string | undefined;
    let loginBlockedUntil: number | undefined = blocked ? prev?.loginBlockedUntil : undefined;
    if (!session && !blocked) {
      try {
        session = await login();
      } catch (e) {
        if (!(e instanceof NespaLoginError)) throw e;
        loginError = 'NESPA rejected NESPA_ID / NESPA_PW, so scores are missing. Fix them in Vercel; PNUtify waits 6 hours before trying again.';
        loginBlockedUntil = now + LOGIN_BACKOFF_MS;
      }
    }
    let data = await fetchNespa(session, now);
    if (session && !data.sessionValid && !blocked) {
      // The stored session expired: log in once more and re-read the scores.
      await redis.del(OWNER_KEYS.nespaSession);
      session = await login();
      data = await fetchNespa(session, now);
    }
    const { sessionValid: _unused, ...clean } = data;
    void _unused;
    return { configured: true, ok: true, data: clean, syncedAt: now, error: loginError ?? (blocked ? prev?.error : undefined), loginBlockedUntil };
  } catch (e) {
    return { ...kept, ok: false, error: `Couldn't read NESPA: ${message(e)}` };
  }
}

/** Re-reads PLATO and NESPA and stores the result. Concurrent calls share one run. */
export async function syncOwner(now = Date.now()): Promise<OwnerData | null> {
  const redis = getRedis();
  if (!redis || !ownerEnabled()) return null;
  const run = async () => {
    const prev = await getOwnerData();
    const [plato, nespa] = await Promise.all([syncPlato(redis, now, prev?.plato), syncNespa(redis, now, prev?.nespa)]);
    const data: OwnerData = { checkedAt: now, plato, nespa };
    await redis.set(OWNER_KEYS.data, data);
    return data;
  };
  return (await withLock(redis, OWNER_KEYS.syncLock, 60, run)) ?? getOwnerData();
}

export const ownerDataStale = (d: OwnerData | null, now: number) => !d || now - d.checkedAt >= OWNER_SYNC_EVERY_MS;

// ---------- the owner's tasks and read state, shared by all owner devices ----------

export type SyncedTask = {
  id: string;
  title: string;
  course: string;
  dueDate: number;
  status: 'pending' | 'completed';
  createdAt: number;
  updatedAt: number;
};

export type OwnerState = {
  tasks: SyncedTask[];
  /** Deleted task id → when. Kept so another device doesn't bring the task back. */
  deleted: Record<string, number>;
  readIds: string[];
  /** PLATO/NESPA item id → done flag and when it was set. */
  external: Record<string, { done: boolean; at: number }>;
};

export const EMPTY_STATE: OwnerState = { tasks: [], deleted: {}, readIds: [], external: {} };
const MAX_READ = 4000;
const TOMBSTONE_MS = 120 * 86_400_000;

export function normalizeState(v: unknown, now = Date.now()): OwnerState {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<OwnerState>;
  const tasks = (Array.isArray(s.tasks) ? s.tasks : [])
    .filter((t): t is SyncedTask => Boolean(t && typeof t.id === 'string' && typeof t.title === 'string' && Number.isFinite(Number(t.dueDate))))
    .slice(0, 500)
    .map((t) => ({
      id: t.id.slice(0, 80),
      title: t.title.slice(0, 200),
      course: String(t.course ?? 'General').slice(0, 80),
      dueDate: Number(t.dueDate),
      status: t.status === 'completed' ? ('completed' as const) : ('pending' as const),
      createdAt: Number(t.createdAt) || now,
      updatedAt: Number(t.updatedAt) || Number(t.createdAt) || 0,
    }));
  const deleted: Record<string, number> = {};
  for (const [id, at] of Object.entries(s.deleted ?? {})) if (Number(at) > now - TOMBSTONE_MS) deleted[id.slice(0, 80)] = Number(at);
  const external: OwnerState['external'] = {};
  for (const [id, x] of Object.entries(s.external ?? {})) if (x && typeof x === 'object') external[id.slice(0, 80)] = { done: x.done === true, at: Number(x.at) || 0 };
  const readIds = (Array.isArray(s.readIds) ? s.readIds : []).filter((x): x is string => typeof x === 'string').slice(-MAX_READ);
  return { tasks, deleted, readIds, external };
}

/** Merges two copies: newest edit wins per task, deletions stick, read is never undone by another device. */
export function mergeStates(a: OwnerState, b: OwnerState): OwnerState {
  const deleted: Record<string, number> = { ...a.deleted };
  for (const [id, at] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, at);

  const tasks = new Map<string, SyncedTask>();
  for (const t of [...a.tasks, ...b.tasks]) {
    const cur = tasks.get(t.id);
    if (!cur || t.updatedAt > cur.updatedAt) tasks.set(t.id, t);
  }
  for (const [id, at] of Object.entries(deleted)) {
    const t = tasks.get(id);
    if (t && t.updatedAt <= at) tasks.delete(id);
  }

  const external: OwnerState['external'] = { ...a.external };
  for (const [id, x] of Object.entries(b.external)) if (!external[id] || x.at > external[id].at) external[id] = x;

  const readIds = [...new Set([...a.readIds, ...b.readIds])].slice(-MAX_READ);
  return { tasks: [...tasks.values()], deleted, readIds, external };
}

export async function getOwnerState(): Promise<OwnerState> {
  const redis = getRedis();
  if (!redis) return EMPTY_STATE;
  return normalizeState(await redis.get(OWNER_KEYS.state).catch(() => null));
}

export async function saveOwnerState(incoming: unknown): Promise<OwnerState> {
  const redis = getRedis();
  if (!redis) throw new Error('redis-not-configured');
  const merged = mergeStates(await getOwnerState(), normalizeState(incoming));
  await redis.set(OWNER_KEYS.state, merged);
  return merged;
}
