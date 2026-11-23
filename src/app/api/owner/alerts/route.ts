import { NextResponse } from 'next/server';
import { isOwnerRequest } from '@/lib/owner';
import { alertStatus } from '@/lib/ownerAlerts';

export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

/** Owner-only: why this device did or didn't get alerts. GET ?deviceId=... */
export async function GET(request: Request) {
  if (!isOwnerRequest(request)) return NextResponse.json({ owner: false }, { status: 401, headers: PRIVATE });
  const status = await alertStatus(new URL(request.url).searchParams.get('deviceId') ?? '');
  if (!status) return NextResponse.json({ error: 'Not available' }, { status: 503, headers: PRIVATE });
  return NextResponse.json(status, { headers: PRIVATE });
}
