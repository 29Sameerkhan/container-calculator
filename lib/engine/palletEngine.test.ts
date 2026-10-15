// /lib/engine/palletEngine.test.ts
import { computeShipment } from './palletEngine';
import type { OrderItem, ShipmentOrder } from '@/lib/types';

// Real data: NHY Trading order — 1 pump item, 1 motor item
const testItems: OrderItem[] = [
  {
    productCode: 'SK77-TEST',
    productType: 'pump',
    palletFamily: 'SK77',
    quantity: 20,
    boxLengthMm: 900,
    boxWidthMm: 300,
    boxHeightMm: 400,
    netWeightKg: 49.25,
    grossWeightKg: 50,
  },
  {
    productCode: 'SM-C-I-10-V6',
    productType: 'motor-V6',
    palletFamily: 'SM-V6',
    quantity: 20,
    boxLengthMm: 450,
    boxWidthMm: 340,
    boxHeightMm: 500,
    netWeightKg: 55,
    grossWeightKg: 56.25,
  },
];

// Two customers consolidated into one shipment
const testOrders: ShipmentOrder[] = [
  { customerName: 'NHY Trading PLC', orderRef: 'TEST-001', items: testItems },
  {
    customerName: 'Al-Noor Trading LLC',
    orderRef: 'TEST-002',
    items: [{
      productCode: 'SK30-TEST',
      productType: 'pump',
      palletFamily: 'SK30',
      quantity: 10,
      boxLengthMm: 500,
      boxWidthMm: 770,
      boxHeightMm: 880,
      netWeightKg: 19,
      grossWeightKg: 20,
    }],
  },
];

const result = computeShipment(testOrders);
console.log('=== Pallet Engine Test ===');
console.log(`Total pallets: ${result.pallets.length}`);
console.log(`Total CBM: ${result.totalCBM} m³`);
console.log(`Total gross weight: ${result.totalGrossKg} kg`);
console.log(`Container recommendation: ${result.containerRecommendation}`);
console.log('Warnings:', result.warnings.length ? result.warnings : 'None');
result.pallets.forEach((p) => {
  console.log(`  ${p.palletId}: ${p.customerName} (${p.orderRef}) | ${p.lengthMm}×${p.widthMm}×${p.heightMm}mm | ${p.cbm} m³ | ${p.totalGrossKg} kg`);
});
console.log('Per customer:');
result.perCustomer.forEach((c) => {
  console.log(`  ${c.customerName} (${c.orderRef}): ${c.palletCount} pallets | ${c.totalCBM} m³ | ${c.totalGrossKg} kg`);
});
