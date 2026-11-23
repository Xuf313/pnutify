import type { Redis } from '@upstash/redis';

/**
 * In-memory stand-in for the few Upstash commands the app uses. Values are
 * deep-copied like a real round trip, and every call is counted so tests can
 * check how many commands a run costs.
 */
export class FakeRedis {
  kv = new Map<string, unknown>();
  hashes = new Map<string, Record<string, unknown>>();
  sets = new Map<string, Set<string>>();
  zsets = new Map<string, Map<string, number>>();
  commands = 0;

  private copy<T>(v: T): T {
    return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
  }

  async get<T>(key: string): Promise<T | null> {
    this.commands++;
    return this.kv.has(key) ? this.copy(this.kv.get(key) as T) : null;
  }
  async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }): Promise<'OK' | null> {
    this.commands++;
    if (opts?.nx && this.kv.has(key)) return null;
    this.kv.set(key, this.copy(value));
    return 'OK';
  }
  async mget<T extends unknown[]>(...keys: string[]): Promise<T> {
    this.commands++;
    return keys.map((k) => (this.kv.has(k) ? this.copy(this.kv.get(k)) : null)) as T;
  }
  async del(...keys: string[]): Promise<number> {
    this.commands++;
    let n = 0;
    for (const k of keys) if (this.kv.delete(k) || this.hashes.delete(k) || this.sets.delete(k)) n++;
    return n;
  }
  async exists(key: string): Promise<number> {
    this.commands++;
    return this.kv.has(key) ? 1 : 0;
  }
  async expire(): Promise<number> {
    this.commands++;
    return 1;
  }
  async hgetall<T>(key: string): Promise<T | null> {
    this.commands++;
    const h = this.hashes.get(key);
    return h && Object.keys(h).length > 0 ? this.copy(h as T) : null;
  }
  async hset(key: string, values: Record<string, unknown>): Promise<number> {
    this.commands++;
    this.hashes.set(key, { ...(this.hashes.get(key) ?? {}), ...this.copy(values) });
    return Object.keys(values).length;
  }
  async hdel(key: string, ...fields: string[]): Promise<number> {
    this.commands++;
    const h = this.hashes.get(key) ?? {};
    for (const f of fields) delete h[f];
    return fields.length;
  }
  async smembers(key: string): Promise<string[]> {
    this.commands++;
    return [...(this.sets.get(key) ?? [])];
  }
  async sadd(key: string, ...members: string[]): Promise<number> {
    this.commands++;
    const s = this.sets.get(key) ?? new Set<string>();
    members.forEach((m) => s.add(m));
    this.sets.set(key, s);
    return members.length;
  }
  async srem(key: string, ...members: string[]): Promise<number> {
    this.commands++;
    members.forEach((m) => this.sets.get(key)?.delete(m));
    return members.length;
  }
  async zadd(key: string, ...entries: { score: number; member: string }[]): Promise<number> {
    this.commands++;
    const z = this.zsets.get(key) ?? new Map<string, number>();
    for (const e of entries) z.set(e.member, e.score);
    this.zsets.set(key, z);
    return entries.length;
  }
  /** Only the by-score form with scores is used. */
  async zrange(key: string, min: number | string, max: number | string): Promise<(string | number)[]> {
    this.commands++;
    const lo = min === '-inf' ? -Infinity : Number(min);
    const hi = max === '+inf' ? Infinity : Number(max);
    return [...(this.zsets.get(key) ?? new Map<string, number>())]
      .filter(([, s]) => s >= lo && s <= hi)
      .sort((a, b) => a[1] - b[1])
      .flatMap(([m, s]) => [m, s]);
  }
  /** Only the lock-release script is used. */
  async eval(_script: string, keys: string[], args: string[]): Promise<number> {
    this.commands++;
    if (this.kv.get(keys[0]) === args[0]) {
      this.kv.delete(keys[0]);
      return 1;
    }
    return 0;
  }

  asRedis(): Redis {
    return this as unknown as Redis;
  }
}
