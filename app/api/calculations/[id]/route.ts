import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { calculations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  try {
    const [row] = await db.select().from(calculations).where(eq(calculations.id, id)).limit(1);
    if (!row) {
      return NextResponse.json({ error: 'Calculation not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      calculation: {
        id: row.id,
        customerName: row.customerName,
        orderRef: row.orderRef,
        items: JSON.parse(row.itemsJson),
        result: JSON.parse(row.resultJson),
        createdAt: row.createdAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Fetch failed', message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Strict check (not parseInt): "6abc" must be rejected, not treated as 6
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  try {
    const deleted = await db.delete(calculations).where(eq(calculations.id, id)).returning({ id: calculations.id });
    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Calculation not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
