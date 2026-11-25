/**
 * Short summaries of class announcements (PLATO course news, NESPA notices)
 * for the Briefing. No AI: the first real sentences of the post, without the
 * greeting and sign-in lines professors usually start with.
 */

type Post = { id: string; title: string; course: string; source: 'PLATO' | 'NESPA'; postedAt: number | null; excerpt?: string };

const DAY = 86_400_000;

/** Opening lines that say nothing: greetings, "this is Prof. Kim", "Dear students". */
const FILLER = [
  /^(안녕하(세요|십니까)|반갑습니다)/,
  /^(수강생|학생|학우)?\s*여러분[,!.\s]*(안녕하(세요|십니까))?[,!.\s]*$/,
  /^.{0,30}(교수|조교|강사|TA)(입니다|예요|이에요)[.!]?$/,
  /^(hello|hi|hey|dear|good (morning|afternoon|evening))\b/i,
  /^(this is|i am|i'm)\s.{0,30}(professor|prof\.|ta|instructor)\b/i,
];

/** "중간고사 강의실이 201호로 바뀌었습니다. 시간은 같습니다." from a longer post, at most `max` characters. */
export function summarize(excerpt: string | undefined, max = 120): string {
  const text = (excerpt ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // Sentences end in . ! ? (Korean ones too: "…니다." "…요."); keep the punctuation.
  const sentences = text.match(/[^.!?。]+[.!?。]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const kept = sentences.filter((s) => !FILLER.some((f) => f.test(s)));
  const body = (kept.length > 0 ? kept : sentences).join(' ');
  if (body.length <= max) return body;
  const cut = body.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).trimEnd()}…`;
}

export type ClassDigest<P extends Post> = {
  /** Posted in the last 7 days, newest first. */
  week: P[];
  /** Courses with announcements this week, most first: [["운영체제", 2], ["자료구조", 1]]. */
  byCourse: [string, number][];
  /** The newest announcement of all, for weeks when nothing new came. */
  latest: P | null;
};

export function classDigest<P extends Post>(posts: P[], now: number): ClassDigest<P> {
  const sorted = [...posts].filter((p) => p.postedAt !== null).sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
  const week = sorted.filter((p) => now - (p.postedAt ?? 0) < 7 * DAY);
  const counts = new Map<string, number>();
  for (const p of week) {
    const course = p.course || p.source;
    counts.set(course, (counts.get(course) ?? 0) + 1);
  }
  return { week, byCourse: [...counts].sort((a, b) => b[1] - a[1]), latest: sorted[0] ?? null };
}

/** The sentence for the Briefing's summary line. */
export function classSentence(d: ClassDigest<Post>): string {
  if (d.week.length === 0) return 'No new class announcements this week.';
  const courses = d.byCourse.map(([c]) => c);
  const list = courses.length <= 3 ? courses.join(', ') : `${courses.slice(0, 3).join(', ')} and ${courses.length - 3} more`;
  return `${d.week.length} class announcement${d.week.length === 1 ? '' : 's'} this week (${list}).`;
}
