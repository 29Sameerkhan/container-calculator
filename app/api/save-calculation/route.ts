import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { calculations } from '@/lib/db/schema';
import { z } from 'zod';

const SaveSchema = z.object({
  customerName: z.string().default(''),
  orderRef: z.string().default(''),
  items: z.array(z.any()).min(1),
  result: z.object({
    pallets: z.array(z.any()),
    totalCBM: z.number(),
    totalGrossKg: z.number(),
    containerRecommendation: z.string(),
    warnings: z.array(z.string()),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = SaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    const { customerName, orderRef, items, result } = parsed.data;

    const [saved] = await db.insert(calculations).values({
      customerName,
      orderRef,
      totalCbm: result.totalCBM,
      totalGrossKg: result.totalGrossKg,
      containerRecommendation: result.containerRecommendation,
      palletCount: result.pallets.length,
      itemsJson: JSON.stringify(items),
      resultJson: JSON.stringify(result),
    }).returning();

    return NextResponse.json({ success: true, id: saved.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Save failed', message }, { status: 500 });
  }
}
