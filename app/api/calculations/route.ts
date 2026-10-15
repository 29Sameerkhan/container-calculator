import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { calculations } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.select({
      id: calculations.id,
      customerName: calculations.customerName,
      orderRef: calculations.orderRef,
      totalCbm: calculations.totalCbm,
      totalGrossKg: calculations.totalGrossKg,
      containerRecommendation: calculations.containerRecommendation,
      palletCount: calculations.palletCount,
      createdAt: calculations.createdAt,
    }).from(calculations).orderBy(desc(calculations.id)).limit(50);

    return NextResponse.json({ success: true, calculations: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Fetch failed', message }, { status: 500 });
  }
}
