import { NextResponse } from 'next/server';
import { isOwnerRequest, OWNER_KEYS } from '@/lib/owner';
import { getOwnerData, ownerDataStale, syncOwner } from '@/lib/ownerSync';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const notOwner = () => NextResponse.json({ owner: false }, { status: 401, headers: PRIVATE });

/** The owner's PLATO and NESPA data. Everyone else gets 401 and nothing else. */
export async function GET(request: Request) {
  if (!isOwnerRequest(request)) return notOwner();
  let data = await getOwnerData();
  if (ownerDataStale(data, Date.now())) data = await syncOwner();
  return NextResponse.json({ owner: true, data }, { headers: PRIVATE });
}

/** "Sync now": re-reads PLATO and NESPA, at most once a minute. */
export async function POST(request: Request) {
  if (!isOwnerRequest(request)) return notOwner();
  const redis = getRedis();
  const allowed = redis ? await redis.set(OWNER_KEYS.manualSync, 1, { nx: true, ex: 60 }) : null;
  const data = allowed === 'OK' ? await syncOwner() : await getOwnerData();
  return NextResponse.json({ owner: true, data, throttled: allowed !== 'OK' }, { headers: PRIVATE });
}
