import { NextResponse } from 'next/server';
import { isAuthorizedCron } from '@/lib/auth';
import { runNotificationCycle } from '@/lib/push';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const report = await runNotificationCycle();
    return NextResponse.json(report, { status: report.ok ? 200 : 500 });
  } catch (err) {
    console.error('[push/send] run failed', err);
    return NextResponse.json({ ok: false, error: 'Run failed' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
