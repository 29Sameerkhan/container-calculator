import {
  OrderItem,
  PalletPlan,
  ShipmentResult,
} from '@/lib/types';
import {
  CONTAINERS,
  CONTAINER_LENGTH_MM,
  PUMP_PALLET_WIDTH,
  MOTOR_PALLET_WIDTH,
  WOOD_WEIGHT,
  MAX_STACK_HEIGHT_MM,
  PALLET_BASE_HEIGHT_MM,
  MAX_PALLET_GROSS_KG,
  MAX_PUMP_PALLET_LENGTH_MM,
} from '@/lib/constants';

function isMotor(item: OrderItem): boolean {
  return item.productType === 'motor-V4' || item.productType === 'motor-V6';
}

function isPump(item: OrderItem): boolean {
  return item.productType === 'pump';
}

export function resolvePalletWidth(item: OrderItem): number {
  if (item.productType === 'motor-V4') return MOTOR_PALLET_WIDTH['V4'];
  if (item.productType === 'motor-V6') return MOTOR_PALLET_WIDTH['V6'];
  if (item.productType === 'controller' || item.productType === 'spare') {
    console.warn('Controller/spare pallet width defaulting to 715mm — confirm with Mahendra');
    return 715;
  }
  const width = PUMP_PALLET_WIDTH[item.palletFamily];
  if (!width) throw new Error(`Unknown pallet family: ${item.palletFamily}`);
  return width;
}

export function resolveWoodWeight(item: OrderItem, isMixedSku: boolean): number {
  if (isMotor(item)) {
    return isMixedSku ? WOOD_WEIGHT.MOTOR_MIXED_SKU : WOOD_WEIGHT.MOTOR_SINGLE_SKU;
  }
  const heavyFamilies = ['SK77', 'SK95', 'SK95A', 'SK95B'];
  return heavyFamilies.includes(item.palletFamily)
    ? WOOD_WEIGHT.PUMP_HEAVY
    : WOOD_WEIGHT.PUMP_LIGHT;
}

export function computeMotorPalletGeometry(
  item: OrderItem,
  qty: number
): { lengthMm: number; widthMm: number; heightMm: number; motorsPerLayer: number; layers: number } {
  const motorsPerLayer = item.productType === 'motor-V4' ? 4 : 2;
  const palletWidthMm = resolvePalletWidth(item);
  const maxLayers = Math.floor((MAX_STACK_HEIGHT_MM - PALLET_BASE_HEIGHT_MM) / item.boxHeightMm);
  const layers = Math.max(1, Math.min(maxLayers, Math.ceil(qty / motorsPerLayer)));
  const columns = Math.ceil(qty / (motorsPerLayer * layers));
  const lengthMm = columns * item.boxLengthMm;
  const heightMm = layers * item.boxHeightMm + PALLET_BASE_HEIGHT_MM;
  return { lengthMm, widthMm: palletWidthMm, heightMm, motorsPerLayer, layers };
}

export interface SkuOrientation {
  bpr: number;
  rowLengthMm: number;
  palletLengthContrib: number;
  rotated: boolean;
}

export function bestOrientationForSku(
  item: OrderItem,
  palletWidthMm: number,
  qty: number,
): SkuOrientation {
  const bprA = Math.max(1, Math.floor(palletWidthMm / item.boxWidthMm));
  const rowsA = Math.ceil(qty / bprA);
  const lengthA = rowsA * item.boxLengthMm;
  const fitsB = item.boxLengthMm <= palletWidthMm;
  const bprB = fitsB ? Math.max(1, Math.floor(palletWidthMm / item.boxLengthMm)) : 0;
  const rowsB = fitsB ? Math.ceil(qty / bprB) : Infinity;
  const lengthB = fitsB ? rowsB * item.boxWidthMm : Infinity;
  if (fitsB && lengthB < lengthA) {
    return { bpr: bprB, rowLengthMm: item.boxWidthMm, palletLengthContrib: lengthB, rotated: true };
  }
  return { bpr: bprA, rowLengthMm: item.boxLengthMm, palletLengthContrib: lengthA, rotated: false };
}

export function computePumpPalletDimensions(
  skus: Array<{ item: OrderItem; qty: number }>,
  palletWidthMm: number
): { lengthMm: number; widthMm: number; heightMm: number } {
  let totalLengthMm = 0;
  let maxHeightMm = 0;
  for (const { item, qty } of skus) {
    const orient = bestOrientationForSku(item, palletWidthMm, qty);
    totalLengthMm += orient.palletLengthContrib;
    maxHeightMm = Math.max(maxHeightMm, item.boxHeightMm);
  }
  return {
    lengthMm: totalLengthMm,
    widthMm: palletWidthMm,
    heightMm: maxHeightMm + PALLET_BASE_HEIGHT_MM,
  };
}

function consolidationKey(item: OrderItem): string {
  const palletWidthMm = resolvePalletWidth(item);
  const customer = item.customer ?? 'default';
  const category = isMotor(item) ? `motor-${item.productType}` : 'pump';
  return `${customer}::${category}::w${palletWidthMm}`;
}

function buildPumpPallets(
  items: OrderItem[],
  palletCounter: { value: number }
): PalletPlan[] {
  const pallets: PalletPlan[] = [];
  const sorted = [...items].sort((a, b) => b.quantity - a.quantity);
  const remaining = new Map<string, number>(
    sorted.map(item => [item.productCode, item.quantity])
  );

  while (true) {
    const allPlaced = Array.from(remaining.values()).every(q => q === 0);
    if (allPlaced) break;

    let palletGrossKg = 0;
    const palletSkus: Array<{ item: OrderItem; qty: number }> = [];

    for (const item of sorted) {
      const rem = remaining.get(item.productCode) ?? 0;
      if (rem === 0) continue;
      const headroom = MAX_PALLET_GROSS_KG - palletGrossKg;
      if (headroom <= 0) break;
      const maxQty = Math.floor(headroom / item.grossWeightKg);
      if (maxQty === 0) continue;
      const qtyThisPallet = Math.min(rem, maxQty);
      palletSkus.push({ item, qty: qtyThisPallet });
      palletGrossKg += qtyThisPallet * item.grossWeightKg;
      remaining.set(item.productCode, rem - qtyThisPallet);
    }

    if (palletSkus.length === 0) {
      const heavyItem = sorted.find(item => (remaining.get(item.productCode) ?? 0) > 0);
      if (!heavyItem) break;
      palletSkus.push({ item: heavyItem, qty: 1 });
      remaining.set(heavyItem.productCode, (remaining.get(heavyItem.productCode) ?? 1) - 1);
      palletGrossKg = heavyItem.grossWeightKg;
    }

    const palletWidthMm = resolvePalletWidth(palletSkus[0].item);
    const { lengthMm, widthMm, heightMm } = computePumpPalletDimensions(palletSkus, palletWidthMm);
    const isMixedSku = palletSkus.length > 1;
    const woodWeightKg = Math.max(...palletSkus.map(s => resolveWoodWeight(s.item, isMixedSku)));
    const totalGrossKg = palletGrossKg + woodWeightKg;
    const totalNetKg = palletSkus.reduce((sum, { item, qty }) => sum + item.netWeightKg * qty, 0);
    const cbm = (lengthMm * widthMm * heightMm) / 1_000_000_000;
    const palletId = `SK-${String(palletCounter.value).padStart(2, '0')}`;
    palletCounter.value++;

    pallets.push({
      palletId,
      family: palletSkus[0].item.palletFamily,
      productCode: palletSkus[0].item.productCode,
      productCodes: palletSkus.map(s => s.item.productCode),
      quantity: palletSkus.reduce((s, x) => s + x.qty, 0),
      skuBreakdown: palletSkus.map(s => ({
        productCode: s.item.productCode,
        quantity: s.qty,
        netWeightKg: Math.round(s.item.netWeightKg * s.qty * 10) / 10,
        grossWeightKg: Math.round(s.item.grossWeightKg * s.qty * 10) / 10,
      })),
      lengthMm,
      widthMm,
      heightMm,
      cbm: Math.round(cbm * 1000) / 1000,
      netWeightKg: Math.round(totalNetKg * 10) / 10,
      grossWeightKg: Math.round(palletGrossKg * 10) / 10,
      woodWeightKg,
      totalGrossKg: Math.round(totalGrossKg * 10) / 10,
      isMixedSku,
      customer: palletSkus[0].item.customer,
    });
  }

  return pallets;
}

const MAX_MOTORS_PER_PALLET = 24;

function buildMotorPallets(
  items: OrderItem[],
  palletCounter: { value: number }
): PalletPlan[] {
  const pallets: PalletPlan[] = [];
  const remaining = new Map<string, number>(
    items.map(item => [item.productCode, item.quantity])
  );
  const sorted = [...items].sort((a, b) => b.quantity - a.quantity);

  while (true) {
    const allPlaced = Array.from(remaining.values()).every(q => q === 0);
    if (allPlaced) break;

    let palletMotors = 0;
    let palletGrossKg = 0;
    const palletSkus: Array<{ item: OrderItem; qty: number }> = [];

    for (const item of sorted) {
      const rem = remaining.get(item.productCode) ?? 0;
      if (rem === 0) continue;
      const countHeadroom = MAX_MOTORS_PER_PALLET - palletMotors;
      const weightHeadroom = MAX_PALLET_GROSS_KG - palletGrossKg;
      if (countHeadroom <= 0 || weightHeadroom <= 0) break;
      const maxByCount = countHeadroom;
      const maxByWeight = Math.floor(weightHeadroom / item.grossWeightKg);
      const qtyThisPallet = Math.min(rem, maxByCount, maxByWeight);
      if (qtyThisPallet <= 0) continue;
      palletSkus.push({ item, qty: qtyThisPallet });
      palletMotors += qtyThisPallet;
      palletGrossKg += qtyThisPallet * item.grossWeightKg;
      remaining.set(item.productCode, rem - qtyThisPallet);
    }

    if (palletSkus.length === 0) {
      const heavyItem = sorted.find(item => (remaining.get(item.productCode) ?? 0) > 0);
      if (!heavyItem) break;
      palletSkus.push({ item: heavyItem, qty: 1 });
      remaining.set(heavyItem.productCode, (remaining.get(heavyItem.productCode) ?? 1) - 1);
      palletMotors = 1;
      palletGrossKg = heavyItem.grossWeightKg;
    }

    const repItem = palletSkus[0].item;
    const totalQty = palletSkus.reduce((s, x) => s + x.qty, 0);
    const { lengthMm, widthMm, heightMm } = computeMotorPalletGeometry(repItem, totalQty);
    const isMixedSku = palletSkus.length > 1;
    const woodWeightKg = Math.max(...palletSkus.map(s => resolveWoodWeight(s.item, isMixedSku)));
    const totalGrossKg = palletGrossKg + woodWeightKg;
    const totalNetKg = palletSkus.reduce((sum, { item, qty }) => sum + item.netWeightKg * qty, 0);
    const cbm = (lengthMm * widthMm * heightMm) / 1_000_000_000;
    const palletId = `SK-${String(palletCounter.value).padStart(2, '0')}`;
    palletCounter.value++;

    pallets.push({
      palletId,
      family: repItem.palletFamily,
      productCode: repItem.productCode,
      productCodes: palletSkus.map(s => s.item.productCode),
      quantity: totalQty,
      skuBreakdown: palletSkus.map(s => ({
        productCode: s.item.productCode,
        quantity: s.qty,
        netWeightKg: Math.round(s.item.netWeightKg * s.qty * 10) / 10,
        grossWeightKg: Math.round(s.item.grossWeightKg * s.qty * 10) / 10,
      })),
      lengthMm,
      widthMm,
      heightMm,
      cbm: Math.round(cbm * 1000) / 1000,
      netWeightKg: Math.round(totalNetKg * 10) / 10,
      grossWeightKg: Math.round(palletGrossKg * 10) / 10,
      woodWeightKg,
      totalGrossKg: Math.round(totalGrossKg * 10) / 10,
      isMixedSku,
      customer: repItem.customer,
    });
  }

  return pallets;
}

export function buildPalletPlans(items: OrderItem[]): PalletPlan[] {
  const pallets: PalletPlan[] = [];
  const palletCounter = { value: 1 };
  const groups = new Map<string, OrderItem[]>();

  for (const item of items) {
    const key = consolidationKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  for (const groupItems of Array.from(groups.values())) {
    const firstItem = groupItems[0];
    if (isMotor(firstItem)) {
      pallets.push(...buildMotorPallets(groupItems, palletCounter));
    } else {
      pallets.push(...buildPumpPallets(groupItems, palletCounter));
    }
  }

  return pallets;
}

const LCL_THRESHOLD_CBM = 15;

export function computeShipment(items: OrderItem[]): ShipmentResult {
  const pallets = buildPalletPlans(items);
  const warnings: string[] = [];
  const totalCBM = pallets.reduce((sum, p) => sum + p.cbm, 0);
  const totalGrossKg = pallets.reduce((sum, p) => sum + p.totalGrossKg, 0);
  const requires40ft = pallets.some((p) => p.lengthMm > CONTAINER_LENGTH_MM.FCL_20FT);

  pallets.forEach((p) => {
    if (p.heightMm > MAX_STACK_HEIGHT_MM) {
      warnings.push(`${p.palletId}: height ${p.heightMm}mm exceeds max stack height ${MAX_STACK_HEIGHT_MM}mm`);
    }
    if (p.lengthMm > CONTAINER_LENGTH_MM.FCL_20FT) {
      warnings.push(`${p.palletId}: length ${p.lengthMm}mm exceeds 20ft internal length — requires 40ft container`);
    }
    if (p.lengthMm > MAX_PUMP_PALLET_LENGTH_MM) {
      warnings.push(`${p.palletId}: length ${p.lengthMm}mm exceeds practical pallet limit (${MAX_PUMP_PALLET_LENGTH_MM}mm) — verify floor-plan with Mahendra`);
    }
    if (p.totalGrossKg > MAX_PALLET_GROSS_KG + (p.woodWeightKg ?? 0)) {
      warnings.push(`${p.palletId}: gross weight ${p.totalGrossKg}kg — verify forklift capacity`);
    }
  });

  let containerRecommendation: ShipmentResult['containerRecommendation'];
  if (totalCBM <= LCL_THRESHOLD_CBM) {
    containerRecommendation = 'LCL';
    warnings.push('LCL recommended — volume too small for FCL. Consolidation charges will apply.');
  } else if (totalCBM <= CONTAINERS.FCL_20FT.maxCBM && totalGrossKg <= CONTAINERS.FCL_20FT.maxPayloadKg && !requires40ft) {
    containerRecommendation = 'FCL_20FT';
  } else if (totalCBM <= CONTAINERS.FCL_40FT.maxCBM && totalGrossKg <= CONTAINERS.FCL_40FT.maxPayloadKg) {
    containerRecommendation = 'FCL_40FT';
  } else {
    containerRecommendation = 'MULTI_CONTAINER';
    const containersByVolume = Math.ceil(totalCBM / CONTAINERS.FCL_40FT.maxCBM);
    const containersByWeight = Math.ceil(totalGrossKg / CONTAINERS.FCL_40FT.maxPayloadKg);
    const containersNeeded = Math.max(containersByVolume, containersByWeight);
    const limitingFactor = containersByVolume >= containersByWeight ? 'volume' : 'weight';
    warnings.push(`Requires ~${containersNeeded} × 40ft FCL — limited by ${limitingFactor}.`);
  }

  if (requires40ft && containerRecommendation === 'FCL_20FT') {
    containerRecommendation = 'FCL_40FT';
    warnings.push('One or more pallets exceed 5,898mm — 20ft not possible');
  }

  if (containerRecommendation === 'FCL_20FT') {
    const u = totalGrossKg / CONTAINERS.FCL_20FT.maxPayloadKg;
    if (u > 0.9) warnings.push(`20ft payload at ${(u * 100).toFixed(0)}% — approaching limit`);
  }
  if (containerRecommendation === 'FCL_40FT') {
    const u = totalGrossKg / CONTAINERS.FCL_40FT.maxPayloadKg;
    if (u > 0.9) warnings.push(`40ft payload at ${(u * 100).toFixed(0)}% — approaching limit`);
  }

  return {
    pallets,
    totalCBM: Math.round(totalCBM * 1000) / 1000,
    totalGrossKg: Math.round(totalGrossKg * 10) / 10,
    containerRecommendation,
    warnings,
  };
}