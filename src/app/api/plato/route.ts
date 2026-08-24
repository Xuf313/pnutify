import { NextResponse } from 'next/server';
import { loginAndScrapePlato } from '@/lib/scrapePlato';

// Interactive-only: logs in with whatever credentials the request sends and
// returns the result. Nothing is persisted server-side — with multiple
// students potentially using this app, storing other people's university
// passwords in a shared store isn't something to take on lightly.
export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    const result = await loginAndScrapePlato(username, password);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });
    return NextResponse.json({ classes: result.classes, announcements: result.announcements, tasks: result.tasks });
  } catch (error) {
    console.error('PLATO scraping error:', error);
    return NextResponse.json({ error: 'Failed to sync with PLATO. Network error.' }, { status: 500 });
  }
}