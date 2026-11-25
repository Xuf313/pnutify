import { describe, expect, it } from 'vitest';
import { classDigest, classSentence, summarize } from '../client/classSummary';

const NOW = Date.parse('2026-11-25T09:00:00+09:00');
const DAY = 86_400_000;
const post = (id: string, course: string, daysAgo: number, excerpt = '') => ({
  id,
  title: `Post ${id}`,
  course,
  source: 'PLATO' as const,
  postedAt: NOW - daysAgo * DAY,
  excerpt,
});

describe('summaries of class announcements', () => {
  it('skips the greeting and the "this is Prof. …" line', () => {
    expect(summarize('안녕하세요, 운영체제 담당 김교수입니다. 중간고사 강의실이 201호로 바뀌었습니다. 시간은 같습니다.')).toBe(
      '중간고사 강의실이 201호로 바뀌었습니다. 시간은 같습니다.',
    );
    expect(summarize('수강생 여러분 안녕하세요. 이번 주 금요일 수업은 휴강입니다.')).toBe('이번 주 금요일 수업은 휴강입니다.');
    expect(summarize('Dear students, Hello. The quiz moved to Friday 3 pm. Bring a pen.')).toBe('The quiz moved to Friday 3 pm. Bring a pen.');
  });

  it('keeps a post that is only a greeting rather than showing nothing', () => {
    expect(summarize('안녕하세요!')).toBe('안녕하세요!');
    expect(summarize('')).toBe('');
  });

  it('cuts long posts at a word, with an ellipsis', () => {
    const s = summarize('기말 프로젝트 제출 방법이 변경되었습니다. '.repeat(10), 60);
    expect(s.length).toBeLessThanOrEqual(61);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('the week in classes', () => {
  it('counts this week by course and keeps the latest for quiet weeks', () => {
    const d = classDigest([post('a', '운영체제', 1), post('b', '자료구조', 2), post('c', '운영체제', 3), post('d', '선형대수', 12)], NOW);
    expect(d.week.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(d.byCourse).toEqual([
      ['운영체제', 2],
      ['자료구조', 1],
    ]);
    expect(classSentence(d)).toBe('3 class announcements this week (운영체제, 자료구조).');

    const quiet = classDigest([post('d', '선형대수', 12)], NOW);
    expect(quiet.week).toEqual([]);
    expect(quiet.latest?.id).toBe('d');
    expect(classSentence(quiet)).toBe('No new class announcements this week.');
  });
});
