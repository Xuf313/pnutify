import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  articleIdFromUrl,
  BOARDS,
  dedupeNotices,
  extractArticleTitle,
  fetchFullTitle,
  findNextPageUrl,
  mayBeCutOff,
  parseBoardDate,
  parseBoardPage,
  scrapeBoard,
  scrapeFirstPage,
  type ScrapedNotice,
} from '../scrapeNotices';

// Real pages saved from both boards on 2026-11-19 (scripts and styles removed).
// If the university changes its layout, refresh these and fix the parser until this passes.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');
const CSE = BOARDS.find((b) => b.source === 'cse')!;
const INTL = BOARDS.find((b) => b.source === 'international')!;
const NOW = Date.parse('2026-11-19T12:00:00+09:00');

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string) => string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = handler(String(url));
      return body === null ? new Response('error', { status: 500 }) : new Response(body, { status: 200 });
    }),
  );
}

describe.each([
  ['CSE', CSE, 'cse', /^cse_\d+$/],
  ['International', INTL, 'intl', /^intl_\d+$/],
] as const)('parseBoardPage on the real %s board', (_label, board, file, idPattern) => {
  const { notices, rowCount } = parseBoardPage(fixture(file), board);

  it('finds a full page of notices', () => {
    expect(rowCount).toBeGreaterThan(10);
    expect(notices.length).toBeGreaterThan(10);
  });

  it('gives every notice a stable article-number id', () => {
    for (const n of notices) expect(n.id).toMatch(idPattern);
  });

  it('repeats an id only for a pinned post that is also in the regular list, and dedupe merges them', () => {
    const byId = new Map<string, ScrapedNotice[]>();
    for (const n of notices) byId.set(n.id, [...(byId.get(n.id) ?? []), n]);
    for (const copies of byId.values()) {
      if (copies.length > 1) expect(copies.map((c) => c.pinned).sort()).toEqual([false, true]);
    }
    const merged = dedupeNotices(notices);
    expect(merged).toHaveLength(byId.size);
    for (const [id, copies] of byId) expect(merged.find((n) => n.id === id)!.pinned).toBe(copies.some((c) => c.pinned));
  });

  it('reads a date, a title and a direct article link for every row', () => {
    for (const n of notices) {
      expect(n.postedAt).not.toBeNull();
      expect(n.title.length).toBeGreaterThan(3);
      expect(n.title).not.toMatch(/새글|\bNEW\b/);
      expect(n.url).toMatch(/^https:\/\/[a-z.]+pusan\.ac\.kr\/bbs\/.+\/artclView\.do$/);
    }
  });

  it('separates pinned posts from regular ones', () => {
    expect(notices.some((n) => n.pinned)).toBe(true);
    expect(notices.some((n) => !n.pinned)).toBe(true);
  });
});

describe('cut-off titles', () => {
  it('flags the International titles the board cut at 60 characters', () => {
    const { notices } = parseBoardPage(fixture('intl'), INTL);
    const cut = notices.find((n) => n.id === 'intl_1474438')!;
    expect(cut.title.endsWith('4th Korean C')).toBe(true);
    expect(cut.title).toHaveLength(INTL.titleCut);
    expect(mayBeCutOff(cut)).toBe(true);
  });

  it('only flags titles long enough to have been cut', () => {
    for (const [board, file] of [[CSE, 'cse'], [INTL, 'intl']] as const) {
      const { notices } = parseBoardPage(fixture(file), board);
      const flagged = notices.filter(mayBeCutOff);
      expect(flagged.length).toBeGreaterThan(0);
      expect(flagged.length).toBeLessThan(notices.length);
      // No title is ever longer than the cut, which is what makes the cut detectable.
      for (const n of notices) expect(n.title.length).toBeLessThanOrEqual(board.titleCut);
    }
  });

  it('reads the full title from the article page', () => {
    expect(extractArticleTitle(fixture('intl-article'))).toBe(
      '2026-2학기 외국인 학생 대상 문화체험(4차) 참가자 모집/ (Fall 2026) 4th Korean Cultural Experience Program',
    );
    expect(extractArticleTitle(fixture('cse-article'))).toBe('[장학] 2027.1학기 국가장학금 1차 필수 신청 안내(11/24~1/7)');
  });

  it('fetchFullTitle returns the longer title only when it matches the listed one', async () => {
    stubFetch(() => fixture('intl-article'));
    const listed = '2026-2학기 외국인 학생 대상 문화체험(4차) 참가자 모집/ (Fall 2026) 4th Korean C';
    const url = 'https://international.pusan.ac.kr/bbs/international/2081/1474438/artclView.do';
    await expect(fetchFullTitle({ title: listed, url })).resolves.toEqual({
      ok: true,
      title: '2026-2학기 외국인 학생 대상 문화체험(4차) 참가자 모집/ (Fall 2026) 4th Korean Cultural Experience Program',
    });
    // A page for some other article is ignored.
    await expect(fetchFullTitle({ title: 'Completely different notice title here', url })).resolves.toEqual({
      ok: true,
      title: 'Completely different notice title here',
    });
  });

  it('reports a failed lookup so it can be retried later', async () => {
    stubFetch(() => null);
    await expect(fetchFullTitle({ title: 'x'.repeat(60), url: 'https://cse.pusan.ac.kr/a' })).resolves.toEqual({ ok: false, title: 'x'.repeat(60) });
  });
});

describe('ids and helpers', () => {
  it('takes the article number from direct links and from enc= wrappers', () => {
    expect(articleIdFromUrl('https://cse.pusan.ac.kr/bbs/cse/2055/1474371/artclView.do')).toBe('1474371');
    // The wrapper encodes the page number too, which is why it must never be the id.
    const inner = 'fnct1|@@|%2Fbbs%2Fcse%2F2055%2F1474371%2FartclView.do%3Fpage%3D3';
    const enc = encodeURIComponent(Buffer.from(inner).toString('base64'));
    expect(articleIdFromUrl(`https://cse.pusan.ac.kr/cse/14221/subview.do?enc=${enc}`)).toBe('1474371');
  });

  it('parses board dates as midnight KST', () => {
    expect(parseBoardDate('2026.11.19')).toBe(Date.parse('2026-11-19T00:00:00+09:00'));
    expect(parseBoardDate('2026-1-5')).toBe(Date.parse('2026-01-05T00:00:00+09:00'));
    expect(parseBoardDate('yesterday')).toBeNull();
  });

  it('drops the same post listed under two ids', () => {
    const base: ScrapedNotice = { id: 'cse_1', title: 'Exam  schedule', date: '2026.11.19', postedAt: 1, source: 'cse', url: 'u', pinned: false };
    const out = dedupeNotices([base, { ...base, id: 'cse_h123', title: 'Exam schedule' }, { ...base, pinned: true }]);
    expect(out).toHaveLength(1);
    expect(out[0].pinned).toBe(true);
  });

  it('finds a page-2 link on the same site', () => {
    const next = findNextPageUrl(fixture('cse'), 1, CSE.url);
    expect(new URL(next).origin).toBe('https://cse.pusan.ac.kr');
  });
});

describe('scrapeBoard', () => {
  it('stops when the board serves page 1 again, without duplicating anything', async () => {
    const html = fixture('cse');
    stubFetch(() => html);
    const result = await scrapeBoard(CSE, NOW);
    expect(result.ok).toBe(true);
    expect(new Set(result.notices.map((n) => n.id)).size).toBe(result.notices.length);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('reports a board that is down instead of returning an empty list as success', async () => {
    stubFetch(() => null);
    await expect(scrapeBoard(CSE, NOW)).resolves.toEqual({ source: 'cse', ok: false, notices: [] });
  });

  it('checks page 1 with a single request', async () => {
    stubFetch(() => fixture('intl'));
    const page = await scrapeFirstPage(INTL, NOW);
    expect(page.ok).toBe(true);
    expect(page.ids).toContain('intl_1474438');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('treats a page with no readable notices as a failure (layout changed)', async () => {
    stubFetch(() => '<html><body><table><tbody><tr><td>nothing</td></tr></tbody></table></body></html>');
    await expect(scrapeFirstPage(INTL, NOW)).resolves.toMatchObject({ ok: false });
  });
});
