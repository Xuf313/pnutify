import { timingSafeEqual } from 'node:crypto';

/**
 * Cron callers prove themselves with CRON_SECRET, sent either as
 * `Authorization: Bearer <secret>` (Vercel Cron, Upstash QStash, cron-job.org)
 * or as `x-cron-secret: <secret>` (the GitHub Actions workflow).
 * Never accepted in the query string, where it would end up in access logs.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : request.headers.get('x-cron-secret') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
