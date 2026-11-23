import { NextResponse } from 'next/server';
import { createSpace, deleteSpace, formatSyncCode, mergeIntoSpace, normalizeSyncCode, readSpace } from '@/lib/syncSpace';

export const dynamic = 'force-dynamic';

/**
 * Sync codes. The code goes in the `x-sync-code` header, never in the URL,
 * so it doesn't end up in access logs.
 *   POST   { state }            -> creates a space, returns { code, state }
 *   GET    (x-sync-code)        -> { state }          404 if the code is unknown
 *   PUT    (x-sync-code) {state} -> merged { state }  404 if the code is unknown
 *   DELETE (x-sync-code)        -> deletes the synced copy
 */
const PRIVATE = { 'Cache-Control': 'private, no-store' };
const codeOf = (request: Request) => normalizeSyncCode(request.headers.get('x-sync-code'));
const unknown = () => NextResponse.json({ error: 'Unknown sync code' }, { status: 404, headers: PRIVATE });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const { code, state } = await createSpace(body?.state);
    return NextResponse.json({ code: formatSyncCode(code), state }, { headers: PRIVATE });
  } catch {
    return NextResponse.json({ error: 'Could not create a sync code' }, { status: 503, headers: PRIVATE });
  }
}

export async function GET(request: Request) {
  const code = codeOf(request);
  if (!code) return unknown();
  const state = await readSpace(code).catch(() => null);
  return state ? NextResponse.json({ state }, { headers: PRIVATE }) : unknown();
}

export async function PUT(request: Request) {
  const code = codeOf(request);
  if (!code) return unknown();
  const body = await request.json().catch(() => null);
  const state = await mergeIntoSpace(code, body?.state).catch(() => null);
  return state ? NextResponse.json({ state }, { headers: PRIVATE }) : unknown();
}

export async function DELETE(request: Request) {
  const code = codeOf(request);
  if (code) await deleteSpace(code).catch(() => null);
  return NextResponse.json({ ok: true }, { headers: PRIVATE });
}
