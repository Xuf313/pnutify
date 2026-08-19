import { NextResponse } from 'next/server';
import { scrapeAllNotices } from '@/lib/scrapeNotices';

export async function GET() {
  try {
    const notices = await scrapeAllNotices();
    return NextResponse.json({ notices });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch notices' }, { status: 500 });
  }
}
