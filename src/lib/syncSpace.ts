import { createHash, randomBytes } from 'node:crypto';
import { getRedis } from './redis';
import { EMPTY_STATE, mergeStates, normalizeState, type OwnerState } from './ownerSync';

/**
 * Sync codes: students link their devices with a random code instead of an
 * account. The code is the only key (≈100 bits, unguessable); the server
 * stores the shared state under a hash of it and never stores the code.
 */

export type SyncState = OwnerState;

// Crockford base32: no I, L, O or U, so codes are easy to read and type.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 20; // 20 × 5 bits = 100 bits
const TTL_SECONDS = 180 * 86_400; // refreshed on every use

export function generateSyncCode(): string {
  const bytes = randomBytes(LENGTH);
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

/** Accepts what people type: any case, spaces or dashes, O for 0 and I/L for 1. Null if it can't be a code. */
export function normalizeSyncCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const c = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return c.length === LENGTH && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

/** "ABCD-EFGH-JKMN-PQRS-TVWX" */
export const formatSyncCode = (code: string) => code.match(/.{1,4}/g)!.join('-');

const spaceKey = (code: string) => `sync:space:${createHash('sha256').update(`pnutify-sync-v1:${code}`).digest('hex')}`;

// Without Redis (local development and tests) spaces live in memory.
const memory = new Map<string, SyncState>();

async function load(code: string): Promise<SyncState | null> {
  const redis = getRedis();
  const raw = redis ? await redis.get<SyncState>(spaceKey(code)) : memory.get(spaceKey(code));
  return raw ? normalizeState(raw) : null;
}

async function store(code: string, state: SyncState): Promise<void> {
  const redis = getRedis();
  if (redis) await redis.set(spaceKey(code), state, { ex: TTL_SECONDS });
  else memory.set(spaceKey(code), state);
}

/** A new space, seeded with this device's data. */
export async function createSpace(initial: unknown): Promise<{ code: string; state: SyncState }> {
  const code = generateSyncCode();
  const state = mergeStates(EMPTY_STATE, normalizeState(initial));
  await store(code, state);
  return { code, state };
}

export async function readSpace(code: string): Promise<SyncState | null> {
  return load(code);
}

/** Merges a device's copy into the space. Null if the code doesn't exist. */
export async function mergeIntoSpace(code: string, incoming: unknown): Promise<SyncState | null> {
  const current = await load(code);
  if (!current) return null;
  const merged = mergeStates(current, normalizeState(incoming));
  await store(code, merged);
  return merged;
}

export async function deleteSpace(code: string): Promise<void> {
  const redis = getRedis();
  if (redis) await redis.del(spaceKey(code));
  else memory.delete(spaceKey(code));
}
