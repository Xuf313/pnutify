import type { AlertCategories } from './types';
import { getDeviceId } from './storage';

export const NO_ALERTS: AlertCategories = { cse: false, international: false, tasks: false, courses: false };

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'ios-not-installed' | 'not-configured' | 'denied' };

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' };
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!hasApi) return { ok: false, reason: isIOS() && !isStandalone() ? 'ios-not-installed' : 'unsupported' };
  if (!VAPID) return { ok: false, reason: 'not-configured' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  return { ok: true };
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  } catch {
    return null;
  }
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: getDeviceId(), subscription: sub.toJSON() }),
  });
  if (!res.ok) throw new Error('subscribe-failed');
}

/**
 * Returns a working subscription, creating one if needed. Replaces a
 * subscription made with an old server key (otherwise pushes silently fail).
 */
async function ensureSubscription(): Promise<PushSubscription> {
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const key = keyBytes(VAPID);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveSubscription(sub);
  return sub;
}

export async function getAlertState(): Promise<{ categories: AlertCategories; subscribed: boolean }> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return { categories: NO_ALERTS, subscribed: false };
    const res = await fetch(`/api/push/categories?deviceId=${encodeURIComponent(getDeviceId())}`, { cache: 'no-store' });
    const data = await res.json();
    return { categories: { ...NO_ALERTS, ...(data?.categories ?? {}) }, subscribed: true };
  } catch {
    return { categories: NO_ALERTS, subscribed: false };
  }
}

/** Called on every app open: keeps the server's copy alive and repairs it if it was lost. */
export async function refreshSubscription(): Promise<void> {
  if (!pushSupport().ok || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) await ensureSubscription();
  } catch {}
}

export async function setAlerts(patch: Partial<AlertCategories>): Promise<AlertCategories> {
  const turningOn = Object.values(patch).some(Boolean);
  if (turningOn) {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('permission-denied');
    await ensureSubscription();
  }
  const res = await fetch('/api/push/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: getDeviceId(), categories: patch }),
  });
  if (!res.ok) throw new Error('save-failed');
  const data = await res.json();
  const next: AlertCategories = { ...NO_ALERTS, ...(data?.categories ?? {}) };
  if (!next.cse && !next.international && !next.tasks && !next.courses) await turnOffAll();
  return next;
}

export async function turnOffAll(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    await sub?.unsubscribe();
  } catch {}
  await fetch(`/api/push/subscribe?deviceId=${encodeURIComponent(getDeviceId())}`, { method: 'DELETE' }).catch(() => {});
}

export async function sendTest(): Promise<boolean> {
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: getDeviceId() }),
  });
  return res.ok;
}
