import { NextRequest, NextResponse } from 'next/server';
import { computeShipment } from '@/lib/engine/palletEngine';
import { OrderItem, ShipmentOrder } from '@/lib/types';
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
  weightManualEntry: z.boolean().optional(),
});

const ShipmentOrderSchema = z.object({
  customerName: z.string().default(''),
  orderRef: z.string().default(''),
  items: z.array(OrderItemSchema).min(1),
});

// Accepts either a multi-order shipment { orders } or the legacy single order
// { items, customerName, orderRef }. If both are sent, orders wins.
const RequestSchema = z.object({
  orders: z.array(ShipmentOrderSchema).min(1).optional(),
  items: z.array(OrderItemSchema).min(1).optional(),
  customerName: z.string().optional(),
  orderRef: z.string().optional(),
}).refine(body => body.orders !== undefined || body.items !== undefined, {
  message: 'Provide either orders (multi-order) or items (single order)',
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

    const { orders, items, customerName, orderRef } = parsed.data;
    const isMultiOrder = orders !== undefined;
    const shipmentOrders: ShipmentOrder[] = isMultiOrder
      ? orders
      : [{ customerName: customerName ?? '', orderRef: orderRef ?? '', items: items as OrderItem[] }];

    const result = computeShipment(shipmentOrders);

    return NextResponse.json({
      success: true,
      // Single-order header fields; null for a multi-order shipment (see result.perCustomer)
      customerName: isMultiOrder ? null : customerName ?? null,
      orderRef: isMultiOrder ? null : orderRef ?? null,
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
