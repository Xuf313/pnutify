import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getRedis, isValidDeviceId } from './redis';

/**
 * Owner mode: PLATO and NESPA for the site owner only.
 *
 * The owner's own logins live in server environment variables (PLATO_ID,
 * PLATO_PW, NESPA_ID, NESPA_PW) and never reach a browser. A device becomes
 * an owner device by entering OWNER_SECRET once; it then holds an httpOnly
 * cookie derived from that secret. Every other visitor sees the normal app.
 * Changing OWNER_SECRET signs every device out.
 */

export const OWNER_COOKIE = 'pnutify_owner';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const MAX_FAILED_UNLOCKS = 10;
const FAILED_WINDOW_SECONDS = 15 * 60;

export const OWNER_KEYS = {
  devices: 'owner:devices',
  failedUnlocks: 'owner:failed-unlocks',
  platoToken: 'owner:plato-token',
  nespaSession: 'owner:nespa-session',
  data: 'owner:data',
  state: 'owner:state',
  pushed: 'owner:pushed-ids',
  syncLock: 'lock:owner-sync',
  manualSync: 'owner:manual-sync',
} as const;

function secret(): string | null {
  const s = process.env.OWNER_SECRET;
  // Short secrets are refused outright: this key unlocks someone's university data.
  return s && s.length >= 32 ? s : null;
}

export const ownerEnabled = () => secret() !== null;
export const platoConfigured = () => Boolean(process.env.PLATO_ID && process.env.PLATO_PW);
export const nespaConfigured = () => Boolean(process.env.NESPA_ID && process.env.NESPA_PW);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The cookie value: an HMAC of the secret, so the secret itself never sits in a cookie. */
function sessionValue(s: string): string {
  return createHmac('sha256', s).update('pnutify-owner-session-v1').digest('base64url');
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function isOwnerRequest(request: Request): boolean {
  const s = secret();
  const cookie = readCookie(request, OWNER_COOKIE);
  return Boolean(s && cookie && safeEqual(cookie, sessionValue(s)));
}

export function ownerCookie(): string {
  const s = secret();
  if (!s) throw new Error('owner-not-configured');
  return `${OWNER_COOKIE}=${sessionValue(s)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearOwnerCookie = () => `${OWNER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export type UnlockResult = { ok: true } | { ok: false; reason: 'not-configured' | 'wrong-key' | 'locked' };

/** Checks the owner key. Ten wrong tries lock unlocking for 15 minutes (across all visitors). */
export async function tryUnlock(key: unknown, deviceId: unknown): Promise<UnlockResult> {
  const s = secret();
  const redis = getRedis();
  if (!s || !redis) return { ok: false, reason: 'not-configured' };
  const failed = Number(await redis.get<number>(OWNER_KEYS.failedUnlocks)) || 0;
  if (failed >= MAX_FAILED_UNLOCKS) return { ok: false, reason: 'locked' };
  if (typeof key !== 'string' || !safeEqual(key.trim(), s)) {
    await redis.set(OWNER_KEYS.failedUnlocks, failed + 1, { ex: FAILED_WINDOW_SECONDS });
    return { ok: false, reason: 'wrong-key' };
  }
  if (isValidDeviceId(deviceId)) await redis.sadd(OWNER_KEYS.devices, deviceId);
  return { ok: true };
}

export async function forgetOwnerDevice(deviceId: unknown): Promise<void> {
  const redis = getRedis();
  if (redis && isValidDeviceId(deviceId)) await redis.srem(OWNER_KEYS.devices, deviceId);
}

// ---------- encryption at rest for the PLATO key and the NESPA session ----------

function boxKey(): Buffer {
  const s = secret();
  if (!s) throw new Error('owner-not-configured');
  return createHash('sha256').update(`${s}:pnutify-box-v1`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', boxKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function unseal(sealed: unknown): string | null {
  if (typeof sealed !== 'string') return null;
  try {
    const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', boxKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
