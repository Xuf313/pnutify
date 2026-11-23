import { getRedis, isValidDeviceId, KEYS } from './redis';
import { OWNER_KEYS, type LastPush } from './owner';
import { normalizeCategories, type Categories } from './push';
import { readMeta } from './notices';
import { CORE_BOARD_IDS } from './boardList';
import { getOwnerData, getOwnerState } from './ownerSync';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type UpcomingReminder = {
  id: string;
  title: string;
  source: 'PLATO' | 'NESPA' | 'Task';
  dueAt: number;
  /** When each reminder becomes due (24 h and 1 h before), and whether it was already sent to this device. */
  at24: number;
  at1: number;
  sent24: boolean;
  sent1: boolean;
};

export type AlertStatus = {
  now: number;
  /** Last time the scheduled check (or a page view refreshing notices) ran. */
  lastCheckAt: number | null;
  /** Last time deadline reminders were checked; only the scheduled check does this. */
  lastDeadlineCheckAt: number | null;
  device: {
    id: string;
    subscribed: boolean;
    inSendList: boolean;
    ownerDevice: boolean;
    categories: Categories;
    lastPush: LastPush | null;
  };
  upcoming: UpcomingReminder[];
};

/** Everything needed to answer "why didn't I get an alert?" for one owner device. */
export async function alertStatus(deviceId: string, now = Date.now()): Promise<AlertStatus | null> {
  const redis = getRedis();
  if (!redis || !isValidDeviceId(deviceId)) return null;
  const [deadlinesAt, sub, cats, ownTasks, notified, lastPush] = await redis.mget<
    [number | null, unknown, unknown, unknown, unknown, LastPush | null]
  >(
    KEYS.deadlinesCheckedAt,
    KEYS.subscription(deviceId),
    KEYS.categories(deviceId),
    KEYS.tasks(deviceId),
    KEYS.notifiedDeadlines(deviceId),
    OWNER_KEYS.lastPush(deviceId),
  );
  const [devices, owners, data, state, metas] = await Promise.all([
    redis.smembers(KEYS.devices).catch(() => [] as string[]),
    redis.smembers(OWNER_KEYS.devices).catch(() => [] as string[]),
    getOwnerData(),
    getOwnerState(),
    readMeta(redis),
  ]);
  // The cron checks the core boards on every run, so their last check is the cron's last run.
  const checkedAt = Math.max(0, ...CORE_BOARD_IDS.map((id) => metas[id]?.checkedAt ?? 0));

  const sent = new Set(Array.isArray(notified) ? (notified as string[]) : []);
  const done = new Set(Object.entries(state.external).filter(([, x]) => x.done).map(([id]) => id));
  const items: { id: string; title: string; source: UpcomingReminder['source']; dueAt: number }[] = [
    ...(data?.plato.data?.deadlines ?? []).map((d) => ({ id: d.id, title: d.title, source: 'PLATO' as const, dueAt: d.dueAt })),
    ...(data?.nespa.data?.assignments ?? [])
      .filter((a) => a.dueAt !== null && !a.score)
      .map((a) => ({ id: a.id, title: a.title, source: 'NESPA' as const, dueAt: a.dueAt as number })),
    ...(Array.isArray(ownTasks) ? (ownTasks as { id: string; title: string; dueDate: number }[]) : []).map((t) => ({
      id: t.id,
      title: t.title,
      source: 'Task' as const,
      dueAt: Number(t.dueDate),
    })),
  ];
  const upcoming = items
    .filter((t) => !done.has(t.id) && t.dueAt > now && t.dueAt < now + 7 * DAY)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, 8)
    .map((t) => ({
      ...t,
      at24: t.dueAt - DAY,
      at1: t.dueAt - HOUR,
      sent24: sent.has(`${t.id}@${t.dueAt}@24h`),
      sent1: sent.has(`${t.id}@${t.dueAt}@1h`),
    }));

  return {
    now,
    lastCheckAt: checkedAt || null,
    lastDeadlineCheckAt: Number(deadlinesAt) || null,
    device: {
      id: deviceId,
      subscribed: Boolean(sub && typeof sub === 'object' && 'endpoint' in (sub as object)),
      inSendList: (devices as string[]).includes(deviceId),
      ownerDevice: (owners as string[]).includes(deviceId),
      categories: normalizeCategories(cats),
      lastPush: lastPush ?? null,
    },
    upcoming,
  };
}
