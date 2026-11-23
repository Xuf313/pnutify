import type { SyncState } from './owner';

/** Sync codes: link a student's devices without an account. The code is sent in a header, never in a URL. */

const headers = (code: string) => ({ 'Content-Type': 'application/json', 'x-sync-code': code });
const ownOnly = (s: SyncState): SyncState => ({ ...s, tasks: s.tasks.filter((t) => !t.source || t.source === 'own') });

export async function createSyncCode(state: SyncState): Promise<{ code: string; state: SyncState } | null> {
  try {
    const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: ownOnly(state) }) });
    return res.ok ? ((await res.json()) as { code: string; state: SyncState }) : null;
  } catch {
    return null;
  }
}

/** The synced copy, "unknown" if the code doesn't exist (or was deleted), null if offline. */
export async function readSyncCode(code: string): Promise<SyncState | 'unknown' | null> {
  try {
    const res = await fetch('/api/sync', { headers: headers(code), cache: 'no-store' });
    if (res.status === 404) return 'unknown';
    return res.ok ? ((await res.json()).state as SyncState) : null;
  } catch {
    return null;
  }
}

/** Sends this device's copy; returns the merged one ("unknown" if the code is gone). */
export async function pushSyncCode(code: string, state: SyncState): Promise<SyncState | 'unknown' | null> {
  try {
    const res = await fetch('/api/sync', { method: 'PUT', headers: headers(code), body: JSON.stringify({ state: ownOnly(state) }) });
    if (res.status === 404) return 'unknown';
    return res.ok ? ((await res.json()).state as SyncState) : null;
  } catch {
    return null;
  }
}

export async function deleteSyncCode(code: string): Promise<void> {
  await fetch('/api/sync', { method: 'DELETE', headers: headers(code) }).catch(() => {});
}
