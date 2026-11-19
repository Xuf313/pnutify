import { NextResponse } from 'next/server';
import { isOwnerRequest } from '@/lib/owner';
import { getOwnerState, saveOwnerState } from '@/lib/ownerSync';

export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

/** The owner's tasks and read state, shared across the owner's devices. */
export async function GET(request: Request) {
  if (!isOwnerRequest(request)) return NextResponse.json({ owner: false }, { status: 401, headers: PRIVATE });
  return NextResponse.json({ state: await getOwnerState() }, { headers: PRIVATE });
}

/** Body: { state }. Merged with the stored copy; the merged result is returned. */
export async function PUT(request: Request) {
  if (!isOwnerRequest(request)) return NextResponse.json({ owner: false }, { status: 401, headers: PRIVATE });
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json({ state: await saveOwnerState(body?.state) }, { headers: PRIVATE });
  } catch {
    return NextResponse.json({ error: 'Could not save' }, { status: 503, headers: PRIVATE });
  }
}
