import { NextResponse } from 'next/server';
import { DEVICE_TTL_SECONDS, getRedis, isValidDeviceId, KEYS } from '@/lib/redis';

type IncomingTask = { id?: unknown; title?: unknown; course?: unknown; dueDate?: unknown; status?: unknown };

/**
 * Tasks live in the browser. The cron runs with no browser open, so it keeps
 * a minimal copy (title, course, due time) of unfinished, upcoming tasks per
 * device to send deadline reminders. Nothing else is stored.
 */
export async function POST(request: Request) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ ok: false, error: 'Not configured' });
  try {
    const body = await request.json();
    const deviceId = body?.deviceId;
    if (!isValidDeviceId(deviceId)) return NextResponse.json({ ok: false, error: 'Invalid device' }, { status: 400 });
    const tasks: IncomingTask[] = Array.isArray(body?.tasks) ? body.tasks.slice(0, 300) : [];
    const now = Date.now();
    const relevant = tasks
      .map((t) => ({
        id: String(t.id ?? '').slice(0, 80),
        title: String(t.title ?? '').slice(0, 200),
        course: String(t.course ?? '').slice(0, 80),
        dueDate: typeof t.dueDate === 'number' ? t.dueDate : Date.parse(String(t.dueDate ?? '')),
        status: t.status,
      }))
      .filter((t) => t.id && t.title && t.status !== 'completed' && !Number.isNaN(t.dueDate) && t.dueDate > now - 3600_000)
      .map(({ id, title, course, dueDate }) => ({ id, title, course, dueDate }));
    await redis.set(KEYS.tasks(deviceId), relevant, { ex: DEVICE_TTL_SECONDS });
    return NextResponse.json({ ok: true, count: relevant.length });
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to sync tasks' }, { status: 500 });
  }
}
