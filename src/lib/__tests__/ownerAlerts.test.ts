import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeRedis } from './fakeRedis';
import { KEYS, setRedisForTesting } from '../redis';
import { OWNER_KEYS, ownerCookie } from '../owner';
import { alertStatus } from '../ownerAlerts';
import { GET } from '../../app/api/owner/alerts/route';

const NOW = Date.parse('2026-11-23T12:00:00+09:00');
const H = 3_600_000;
let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTesting(redis.asRedis());
  process.env.OWNER_SECRET = 'k'.repeat(48);
});
afterEach(() => {
  setRedisForTesting(null);
  delete process.env.OWNER_SECRET;
});

function ownerData(deadlines: { id: string; title: string; dueAt: number }[]) {
  redis.kv.set(OWNER_KEYS.data, {
    checkedAt: NOW,
    plato: { configured: true, ok: true, data: { name: 'Me', courses: [], announcements: [], deadlines: deadlines.map((d) => ({ ...d, course: 'OS', url: 'u', kind: 'assign' })) } },
    nespa: { configured: false, ok: false },
  });
}

describe('alerts check', () => {
  it('reports a healthy owner device and which reminders were sent', async () => {
    const due = NOW + 20 * H;
    ownerData([{ id: 'plato_1', title: 'HW1', dueAt: due }]);
    redis.kv.set(KEYS.checkedAt, NOW - 60_000);
    redis.kv.set(KEYS.deadlinesCheckedAt, NOW - 120_000);
    redis.kv.set(KEYS.subscription('dev-12345'), { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } });
    redis.kv.set(KEYS.categories('dev-12345'), { tasks: true });
    redis.kv.set(KEYS.notifiedDeadlines('dev-12345'), [`plato_1@${due}@24h`]);
    redis.kv.set(OWNER_KEYS.lastPush('dev-12345'), { at: NOW - 3 * H, ok: true, title: 'Due in 23 hours' });
    redis.sets.set(KEYS.devices, new Set(['dev-12345']));
    redis.sets.set(OWNER_KEYS.devices, new Set(['dev-12345']));

    const s = await alertStatus('dev-12345', NOW);
    expect(s?.device).toMatchObject({ subscribed: true, inSendList: true, ownerDevice: true, categories: { tasks: true } });
    expect(s?.device.lastPush).toMatchObject({ ok: true, title: 'Due in 23 hours' });
    expect(s?.lastDeadlineCheckAt).toBe(NOW - 120_000);
    expect(s?.upcoming).toEqual([{ id: 'plato_1', title: 'HW1', source: 'PLATO', dueAt: due, at24: due - 24 * H, at1: due - H, sent24: true, sent1: false }]);
  });

  it('shows the gaps: not subscribed, reminders off, not an owner device, check never ran', async () => {
    ownerData([]);
    const s = await alertStatus('dev-67890', NOW);
    expect(s).toMatchObject({ lastCheckAt: null, lastDeadlineCheckAt: null, device: { subscribed: false, inSendList: false, ownerDevice: false, categories: { tasks: false }, lastPush: null } });
  });

  it('skips PLATO items ticked off and ones more than a week away', async () => {
    ownerData([
      { id: 'plato_1', title: 'Done already', dueAt: NOW + 5 * H },
      { id: 'plato_2', title: 'Far away', dueAt: NOW + 10 * 24 * H },
      { id: 'plato_3', title: 'Soon', dueAt: NOW + 30 * H },
    ]);
    redis.kv.set(OWNER_KEYS.state, { tasks: [], deleted: {}, readIds: [], external: { plato_1: { done: true, at: 1 } } });
    const s = await alertStatus('dev-12345', NOW);
    expect(s?.upcoming.map((u) => u.title)).toEqual(['Soon']);
  });

  it('is owner-only', async () => {
    const anon = await GET(new Request('https://x/api/owner/alerts?deviceId=dev-12345'));
    expect(anon.status).toBe(401);
    const cookie = ownerCookie().split(';')[0];
    const mine = await GET(new Request('https://x/api/owner/alerts?deviceId=dev-12345', { headers: { cookie } }));
    expect(mine.status).toBe(200);
  });
});
