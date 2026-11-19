import type { Notice } from './types';

const DAY = 86_400_000;

/** Posted in the last 2 days, or first seen by PNUtify in the last day. Drives the "New" badge. */
export function isNewNotice(n: Notice, now: number): boolean {
  const posted = n.postedAt ?? n.firstSeenAt;
  return now - posted < 2 * DAY || now - n.firstSeenAt < DAY;
}

/** What the Briefing counts as new: arrived since the last visit, or new by the rule above. */
export function isFreshNotice(n: Notice, now: number, sinceTs: number): boolean {
  return n.firstSeenAt > sinceTs || isNewNotice(n, now);
}
