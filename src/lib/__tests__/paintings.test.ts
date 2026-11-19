import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAINTINGS, paintingOfTheDay } from '../client/paintings';

const file = (slug: string) => new URL(`../../../public/paintings/${slug}.jpg`, import.meta.url);

describe('paintings of the day', () => {
  it('every painting in the list has an image file', () => {
    for (const p of PAINTINGS) expect(existsSync(file(p.slug)), p.slug).toBe(true);
  });

  it('no two image files are the same picture (a mixed-up download would show the wrong caption)', () => {
    const hashes = PAINTINGS.filter((p) => existsSync(file(p.slug))).map((p) => createHash('sha256').update(readFileSync(file(p.slug))).digest('hex'));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('keeps one painting all day in Korea and changes the next day', () => {
    const morning = Date.parse('2026-11-19T00:30:00+09:00');
    const night = Date.parse('2026-11-19T23:30:00+09:00');
    const tomorrow = Date.parse('2026-11-20T00:30:00+09:00');
    expect(paintingOfTheDay(morning).slug).toBe(paintingOfTheDay(night).slug);
    expect(paintingOfTheDay(tomorrow).slug).not.toBe(paintingOfTheDay(morning).slug);
  });
});
