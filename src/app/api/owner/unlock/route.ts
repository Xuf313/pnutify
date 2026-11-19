import { NextResponse } from 'next/server';
import { clearOwnerCookie, forgetOwnerDevice, isOwnerRequest, ownerCookie, tryUnlock } from '@/lib/owner';

export const dynamic = 'force-dynamic';

/** Body: { key, deviceId }. Turns this device into an owner device. */
export async function POST(request: Request) {
  const { key, deviceId } = (await request.json().catch(() => ({}))) ?? {};
  const result = await tryUnlock(key, deviceId);
  if (!result.ok) {
    const status = result.reason === 'wrong-key' ? 401 : result.reason === 'locked' ? 429 : 503;
    return NextResponse.json({ ok: false, reason: result.reason }, { status });
  }
  return NextResponse.json({ ok: true }, { headers: { 'Set-Cookie': ownerCookie() } });
}

/** Signs this device out of owner mode. */
export async function DELETE(request: Request) {
  if (isOwnerRequest(request)) await forgetOwnerDevice(new URL(request.url).searchParams.get('deviceId'));
  return NextResponse.json({ ok: true }, { headers: { 'Set-Cookie': clearOwnerCookie() } });
}
