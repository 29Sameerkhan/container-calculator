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

// Pallet building limits: 40 boxes × 810mm must be split over forklift-sized
// pallets; a 1,500mm box gets a long pallet; a 2,500mm-tall box fits nothing
const pump = (productCode: string, quantity: number, L: number, W: number, H: number, kg: number): OrderItem => ({
  productCode, productType: 'pump', palletFamily: 'SK17', quantity,
  boxLengthMm: L, boxWidthMm: W, boxHeightMm: H, netWeightKg: kg, grossWeightKg: kg + 0.5,
});
const limits = computeShipment([{
  customerName: 'Limits', orderRef: 'TEST-003',
  items: [pump('SK17-40X810', 40, 810, 152, 152, 19), pump('SK30-LONG', 10, 1500, 152, 152, 25), pump('TOO-TALL', 2, 500, 500, 2500, 10)],
}]);
console.log('=== Pallet limits ===');
limits.pallets.forEach((p) => {
  console.log(`  ${p.palletId}: ${p.quantity} boxes | ${p.lengthMm}×${p.widthMm}×${p.heightMm}mm | ${p.totalGrossKg} kg${p.isLongPallet ? ' | LONG' : ''}`);
});
console.log('Warnings:', limits.warnings);
console.log(`Placed footprints: ${limits.placed?.length} (overflow ${limits.placed?.filter(p => p.overflow).length})`);

const failures = [
  ...limits.pallets.filter(p => !p.isLongPallet && (p.lengthMm > 1200 || p.widthMm > 1000)).map(p => `${p.palletId} larger than a standard pallet`),
  ...limits.pallets.filter(p => p.heightMm > 2200).map(p => `${p.palletId} taller than 2200mm`),
  ...limits.pallets.filter(p => p.totalGrossKg > 1500).map(p => `${p.palletId} over 1500kg`),
  ...(limits.pallets.some(p => p.productCode === 'TOO-TALL') ? ['oversized box was palletised'] : []),
  ...(limits.warnings.some(w => w.includes('OVERSIZED')) ? [] : ['no OVERSIZED warning']),
  ...(limits.warnings.some(w => w.includes('needs flat-bed')) ? [] : ['no long pallet warning']),
];
console.log(failures.length ? `FAIL: ${failures.join('; ')}` : 'PASS: pallet limits respected');
