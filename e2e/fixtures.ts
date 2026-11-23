import { test as base, expect, type Page } from '@playwright/test';

const H = 3_600_000;
const D = 24 * H;

/** Notices as /api/notices returns them, dated relative to now. */
export function noticeSnapshot(now = Date.now()) {
  const n = (id: string, source: string, title: string, ageH: number, pinned = false) => ({
    id,
    title,
    date: new Date(now - ageH * H + 9 * H).toISOString().slice(0, 10).replace(/-/g, '.'),
    postedAt: now - ageH * H,
    source,
    url: source === 'pnu' ? `https://www.pusan.ac.kr/kor/CMS/Board/Board.do?mCode=MN095&mode=view&mgr_seq=3&board_seq=${id.split('_')[1]}` : `https://${source}.pusan.ac.kr/bbs/x/1/${id.split('_')[1]}/artclView.do`,
    pinned,
    firstSeenAt: now - ageH * H,
  });
  return {
    updatedAt: now - 60_000,
    scrapedAt: now - 10 * 60_000,
    staleSources: [],
    failingSince: {},
    notices: [
      n('cse_101', 'cse', '[장학] 국가장학금 신청 안내', 2),
      n('intl_201', 'international', 'Cultural Experience Program for international students', 5),
      n('cse_102', 'cse', '건물 출입 통제 알림', 20),
      n('cse_103', 'cse', 'Old pinned notice about graduation requirements', 24 * 40, true),
      n('intl_202', 'international', 'Visa document review hours', 24 * 10),
      n('math_301', 'math', '2027학년도 수학과 졸업시험 안내', 3),
    ],
  };
}

/** Owner-mode data, for tests that pretend this device is the owner's. */
export function ownerData(now = Date.now()) {
  return {
    owner: true,
    data: {
      checkedAt: now - 3 * 60_000,
      plato: {
        configured: true,
        ok: true,
        syncedAt: now - 3 * 60_000,
        data: {
          name: 'Test Student',
          courses: [{ id: 1, name: '운영체제' }],
          deadlines: [{ id: 'plato_11', title: 'Lab 7 report', course: '운영체제', dueAt: now + 2 * D, url: 'https://plato.pusan.ac.kr/mod/assign/view.php?id=1', kind: 'assign' }],
          announcements: [{ id: 'platonews_5', title: '중간고사 강의실 변경 안내', course: '운영체제', author: 'Prof', postedAt: now - 2 * H, url: 'https://plato.pusan.ac.kr/mod/forum/discuss.php?d=5', excerpt: '201호에서 진행합니다.' }],
        },
      },
      nespa: {
        configured: true,
        ok: true,
        syncedAt: now - 3 * 60_000,
        data: { loggedIn: true, notices: [], assignments: [{ id: 'nespa_15', no: 15, title: 'BTS machine', opensAt: now - 5 * D, dueAt: now - D, score: '100', url: 'https://emerald.pusan.ac.kr/ds2026/submission_detail?prob_id=15' }] },
      },
    },
  };
}

/** Answers the app's own API calls in the browser. Owner endpoints say "not the owner" unless `owner` is set. */
export async function mockApis(page: Page, opts: { owner?: boolean } = {}) {
  // Like the real endpoint: only the boards asked for (the core ones when none are given).
  await page.route('**/api/notices**', (r) => {
    const boards = new URL(r.request().url()).searchParams.get('boards')?.split(',') ?? ['cse', 'international'];
    const snap = noticeSnapshot();
    return r.fulfill({ json: { ...snap, notices: snap.notices.filter((x) => boards.includes(x.source)), boards, pending: [] } });
  });
  await page.route('**/api/notices/notice-detail**', (r) =>
    r.fulfill({
      json: {
        title: '[장학] 국가장학금 신청 안내',
        html: '<p><strong>신청기간: 11/24 ~ 1/7</strong></p><p>Apply on the KOSAF site.</p><table><tr><th>구분</th><th>기간</th></tr><tr><td>1차</td><td>11/24 ~ 1/7</td></tr></table>',
        attachments: [{ name: '붙임1. 안내문.pdf', url: 'https://cse.pusan.ac.kr/bbs/cse/2055/1/download.do' }],
        author: '정*랑',
        date: '2026.11.19',
        sourceUrl: 'https://cse.pusan.ac.kr/bbs/cse/2055/101/artclView.do',
      },
    }),
  );
  await page.route('**/api/tasks/sync', (r) => r.fulfill({ json: { ok: true } }));
  // Not linked to a PLATO calendar unless a test says otherwise.
  await page.route('**/api/plato-calendar**', (r) => r.fulfill({ status: 404, json: { error: 'not-linked' } }));
  await page.route('**/api/push/**', (r) => r.fulfill({ json: { categories: { boards: [], tasks: false, weekly: false, courses: false }, subscribed: false } }));
  if (opts.owner) {
    await page.route('**/api/owner/data', (r) => r.fulfill({ json: ownerData() }));
    await page.route('**/api/owner/state', (r) => r.fulfill({ json: { state: r.request().postDataJSON()?.state ?? {} } }));
  } else {
    await page.route('**/api/owner/**', (r) => r.fulfill({ status: 401, json: { owner: false } }));
  }
}

/** Fails the test on any uncaught page error or console error. */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/status of 401/.test(m.text())) errors.push(m.text());
      });
      await use(errors);
      expect(errors, 'page errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The phone and desktop layouts both render the page content; act on the one that's showing. */
export const visible = (page: Page, selector: string) => page.locator(`${selector} >> visible=true`);
