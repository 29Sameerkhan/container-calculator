import { NextRequest, NextResponse } from 'next/server';
import { ensureShareToken } from '@/lib/db/shareToken';

// The plan's share token, for the Share button and the PDF footer. Plans saved
// before tokens existed get theirs here, so their links are right from the start.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Strict check (not parseInt): "6abc" must be rejected, not treated as 6
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  try {
    const shareToken = await ensureShareToken(id);
    if (!shareToken) {
      return NextResponse.json({ error: 'Calculation not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, shareToken });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
