// /lib/engine/palletEngine.test.ts
import { computeShipment } from './palletEngine';
import type { OrderItem } from '@/lib/types';

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

const result = computeShipment(testItems);
console.log('=== Pallet Engine Test ===');
console.log(`Total pallets: ${result.pallets.length}`);
console.log(`Total CBM: ${result.totalCBM} m³`);
console.log(`Total gross weight: ${result.totalGrossKg} kg`);
console.log(`Container recommendation: ${result.containerRecommendation}`);
console.log('Warnings:', result.warnings.length ? result.warnings : 'None');
result.pallets.forEach((p) => {
  console.log(`  ${p.palletId}: ${p.lengthMm}×${p.widthMm}×${p.heightMm}mm | ${p.cbm} m³ | ${p.totalGrossKg} kg`);
});