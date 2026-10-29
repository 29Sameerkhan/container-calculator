import { NextRequest, NextResponse } from 'next/server';
import { computeShipment } from '@/lib/engine/palletEngine';
import { OrderItem } from '@/lib/types';
import { z } from 'zod';

const OrderItemSchema = z.object({
  productCode: z.string().min(1),
  productType: z.enum(['pump', 'motor-V4', 'motor-V6', 'controller', 'spare']),
  palletFamily: z.string().min(1),
  quantity: z.number().int().min(1),
  boxLengthMm: z.number().min(1),
  boxWidthMm: z.number().min(1),
  boxHeightMm: z.number().min(1),
  netWeightKg: z.number().min(0),
  grossWeightKg: z.number().min(0.01),
  customer: z.string().optional(),
  weightManualEntry: z.boolean().optional(),
});

const ShipmentOrderSchema = z.object({
  customerName: z.string().default(''),
  orderRef: z.string().default(''),
  items: z.array(OrderItemSchema).min(1),
});

// The dashboard sends { orders }; a flat { items } list is also accepted
const RequestSchema = z.object({
  orders: z.array(ShipmentOrderSchema).min(1).optional(),
  items: z.array(OrderItemSchema).min(1).optional(),
  customerName: z.string().optional(),
  orderRef: z.string().optional(),
}).refine(body => body.orders !== undefined || body.items !== undefined, {
  message: 'Provide either orders or items',
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Each order's lines are tagged with its customer so the engine never
    // puts two customers' boxes on one pallet
    const { orders, items } = parsed.data;
    const allItems = orders
      ? orders.flatMap(o => o.items.map(item => ({ ...item, customer: item.customer || o.customerName || o.orderRef })))
      : items!;

    const result = computeShipment(allItems as OrderItem[]);

    return NextResponse.json({
      success: true,
      customerName: parsed.data.customerName ?? null,
      orderRef: parsed.data.orderRef ?? null,
      calculatedAt: new Date().toISOString(),
      result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Engine error', message },
      { status: 500 }
    );
  }
}