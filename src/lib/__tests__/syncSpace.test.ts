import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeRedis } from './fakeRedis';
import { setRedisForTesting } from '../redis';
import { formatSyncCode, generateSyncCode, normalizeSyncCode } from '../syncSpace';
import { DELETE, GET, POST, PUT } from '../../app/api/sync/route';

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTesting(redis.asRedis());
});
afterEach(() => setRedisForTesting(null));

const task = (id: string, title: string, updatedAt: number) => ({ id, title, course: 'General', dueDate: 1_900_000_000_000, status: 'pending', createdAt: 1, updatedAt });
const req = (method: string, code?: string, body?: unknown) =>
  new Request('https://www.pnutify.app/api/sync', {
    method,
    headers: { 'content-type': 'application/json', ...(code ? { 'x-sync-code': code } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

describe('sync codes', () => {
  it('are 20 easy-to-type characters (about 100 bits) and all different', () => {
    const codes = Array.from({ length: 200 }, generateSyncCode);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/);
    expect(new Set(codes).size).toBe(codes.length);
    expect(formatSyncCode('ABCD1234EFGH5678JKMN')).toBe('ABCD-1234-EFGH-5678-JKMN');
  });

  it('accept what people type: lower case, spaces, dashes, O for 0 and I/L for 1', () => {
    expect(normalizeSyncCode('abcd-1234 efgh-5678-jkmn')).toBe('ABCD1234EFGH5678JKMN');
    expect(normalizeSyncCode('ABCD-O23I-EFGH-5678-JKML')).toBe('ABCD0231EFGH5678JKM1');
    expect(normalizeSyncCode('too-short')).toBeNull();
    expect(normalizeSyncCode('ABCD-1234-EFGH-5678-JKM!')).toBeNull();
  });
});

describe('/api/sync', () => {
  it('links two devices: create on one, merge from the other, both see everything', async () => {
    const created = await (await POST(req('POST', undefined, { state: { tasks: [task('a', 'From phone', 10)], readIds: ['n1'] } }))).json();
    expect(created.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);
    expect(created.state.tasks.map((t: { id: string }) => t.id)).toEqual(['a']);

    const laptop = await (await PUT(req('PUT', created.code, { state: { tasks: [task('b', 'From laptop', 20)], readIds: ['n2'] } }))).json();
    expect(laptop.state.tasks.map((t: { id: string }) => t.id).sort()).toEqual(['a', 'b']);
    expect(laptop.state.readIds.sort()).toEqual(['n1', 'n2']);

    const phone = await (await GET(req('GET', created.code.toLowerCase()))).json();
    expect(phone.state.tasks).toHaveLength(2);
  });

  it('stores only a hash of the code, never the code', async () => {
    const { code } = await (await POST(req('POST', undefined, { state: {} }))).json();
    const raw = normalizeSyncCode(code)!;
    expect([...redis.kv.keys()].join(' ')).not.toContain(raw);
    expect(JSON.stringify([...redis.kv.values()])).not.toContain(raw);
  });

  it('answers 404 for a missing or unknown code, and DELETE removes the synced copy', async () => {
    expect((await GET(req('GET'))).status).toBe(404);
    expect((await GET(req('GET', 'ABCD-1234-EFGH-5678-JKMN'))).status).toBe(404);
    expect((await PUT(req('PUT', 'ABCD-1234-EFGH-5678-JKMN', { state: {} }))).status).toBe(404);

    const { code } = await (await POST(req('POST', undefined, { state: {} }))).json();
    expect((await GET(req('GET', code))).status).toBe(200);
    await DELETE(req('DELETE', code));
    expect((await GET(req('GET', code))).status).toBe(404);
  });
});
