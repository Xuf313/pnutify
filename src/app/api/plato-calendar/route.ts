import { NextResponse } from 'next/server';
import { calendarConfigured, linkCalendar, readCalendar, unlinkCalendar } from '@/lib/platoCalendar';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const keyOf = (req: Request) => req.headers.get('x-calendar-key');
const deviceOf = (req: Request) => new URL(req.url).searchParams.get('deviceId');

/** This device's PLATO deadlines. Needs the key the device got when it linked. `?refresh=1` re-reads PLATO first. */
export async function GET(req: Request) {
  if (!calendarConfigured()) return NextResponse.json({ error: 'not-configured' }, { status: 503, headers: PRIVATE });
  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  const calendar = await readCalendar(deviceOf(req), keyOf(req), { refresh });
  if (!calendar) return NextResponse.json({ error: 'not-linked' }, { status: 404, headers: PRIVATE });
  return NextResponse.json({ calendar }, { headers: PRIVATE });
}

/** Body: { deviceId, url }. Checks the link with PLATO, stores it encrypted, returns this device's key. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const result = await linkCalendar(body?.deviceId, body?.url);
  if (!result.ok) {
    const status = { 'not-configured': 503, 'invalid-device': 400, 'invalid-link': 400, rejected: 422, unreachable: 502, 'too-many-tries': 429 }[result.error];
    return NextResponse.json({ error: result.error }, { status, headers: PRIVATE });
  }
  return NextResponse.json({ key: result.key, calendar: result.calendar }, { headers: PRIVATE });
}

/** Deletes the stored link and deadlines. */
export async function DELETE(req: Request) {
  const ok = await unlinkCalendar(deviceOf(req), keyOf(req));
  return NextResponse.json({ ok }, { status: ok ? 200 : 404, headers: PRIVATE });
}
