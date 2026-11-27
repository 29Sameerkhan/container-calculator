import { OrderItem, ShipmentOrder } from '@/lib/types';

// The engine's input from a list of orders: each line tagged with its order's
// customer, so the engine never puts two customers' boxes on one pallet
export function engineItems(orders: ShipmentOrder[]): OrderItem[] {
  return orders.flatMap(o => o.items.map(item => ({ ...item, customer: item.customer || o.customerName || o.orderRef })));
}

// A saved calculation's orders: items_json is OrderItem[] for a single order,
// or ShipmentOrder[] for a multi-order shipment
export function savedOrderList(items: unknown, customerName: string, orderRef: string): ShipmentOrder[] {
  const list = Array.isArray(items) ? items : [];
  const isOrderList = list.length > 0 && Array.isArray((list[0] as ShipmentOrder)?.items);
  return isOrderList
    ? (list as ShipmentOrder[])
    : [{ customerName, orderRef, items: list as OrderItem[] }];
}
