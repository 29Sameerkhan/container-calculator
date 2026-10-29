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
import { packPallets } from '@/lib/engine/floorPlan';

// Stacked pair limits: forklift clearance (not the full container height) and
// the forklift's lifting capacity
const MAX_STACKED_HEIGHT_MM = 2200;
const MAX_STACKED_GROSS_KG = 1500;

function isMotor(item: OrderItem): boolean {
  return item.productType.startsWith('motor-');
}



export function resolvePalletWidth(item: OrderItem): number {
  if (item.productType === 'motor-V4') return MOTOR_PALLET_WIDTH['V4'];
  if (item.productType === 'motor-V6') return MOTOR_PALLET_WIDTH['V6'];
  // No 8" pallet width from the factory yet; use the widest motor pallet
  if (item.productType === 'motor-V8') return MOTOR_PALLET_WIDTH['V6'];
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
  const palletWidthMm = resolvePalletWidth(item);
  // As many motors across as the pallet width holds
  const motorsPerLayer = Math.max(1, Math.floor(palletWidthMm / item.boxWidthMm));
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
  // More boxes per row means fewer layers, so a lower pallet; the shorter
  // length only decides between orientations of equal density
  if (fitsB && (bprB > bprA || (bprB === bprA && lengthB < lengthA))) {
    return { bpr: bprB, rowLengthMm: item.boxWidthMm, palletLengthContrib: lengthB, rotated: true };
  }
  return { bpr: bprA, rowLengthMm: item.boxLengthMm, palletLengthContrib: lengthA, rotated: false };
}

// Pump stage boxes are long tubes with a square face (e.g. 1354×152×152)
export function isSquareTubeBox(item: OrderItem): boolean {
  return item.boxWidthMm === item.boxHeightMm;
}

export function computePumpPalletDimensions(
  skus: Array<{ item: OrderItem; qty: number }>,
  palletWidthMm: number
): { lengthMm: number; widthMm: number; heightMm: number } {
  let totalLengthMm = 0;
  let maxHeightMm = 0;

  // Square tubes (pump stage boxes) of every length share one block, like
  // motors: as many across as fit, stacked in layers, as long as the longest
  const tubes = skus.filter(s => isSquareTubeBox(s.item));
  if (tubes.length > 0) {
    const tubeFaceMm = Math.max(...tubes.map(s => s.item.boxWidthMm));
    const tubeCount = tubes.reduce((sum, s) => sum + s.qty, 0);
    const bpr = Math.max(1, Math.floor(palletWidthMm / tubeFaceMm));
    const maxLayers = Math.max(1, Math.floor((MAX_STACK_HEIGHT_MM - PALLET_BASE_HEIGHT_MM) / tubeFaceMm));
    const layersNeeded = Math.min(maxLayers, Math.ceil(tubeCount / bpr));
    const rows = Math.ceil(tubeCount / (bpr * layersNeeded));
    totalLengthMm += rows * Math.max(...tubes.map(s => s.item.boxLengthMm));
    maxHeightMm = layersNeeded * tubeFaceMm + PALLET_BASE_HEIGHT_MM;
  }

  // Other boxes: each SKU is one row of boxes across the pallet, stacked only as
  // many layers as its boxes need. Extra rows only if that would pass the stack height.
  for (const { item, qty } of skus.filter(s => !isSquareTubeBox(s.item))) {
    const orient = bestOrientationForSku(item, palletWidthMm, qty);
    const maxLayers = Math.max(1, Math.floor((MAX_STACK_HEIGHT_MM - PALLET_BASE_HEIGHT_MM) / item.boxHeightMm));
    const layersNeeded = Math.min(maxLayers, Math.ceil(qty / orient.bpr));
    const rows = Math.ceil(qty / (orient.bpr * layersNeeded));
    totalLengthMm += rows * orient.rowLengthMm;
    const skuHeightMm = layersNeeded * item.boxHeightMm + PALLET_BASE_HEIGHT_MM;
    maxHeightMm = Math.max(maxHeightMm, skuHeightMm);
  }
  return {
    lengthMm: totalLengthMm,
    widthMm: palletWidthMm,
    heightMm: maxHeightMm,
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
  const MAX_PUMP_BOXES_PER_PALLET = 30;
  const pallets: PalletPlan[] = [];
  const sorted = [...items].sort((a, b) => b.quantity - a.quantity);
  const remaining = new Map<string, number>(
    sorted.map(item => [item.productCode, item.quantity])
  );
  // The 1500kg limit is for the whole pallet, wood included
  const woodReserveKg = Math.max(...items.map(i => resolveWoodWeight(i, true)));

  while (true) {
    const allPlaced = Array.from(remaining.values()).every(q => q === 0);
    if (allPlaced) break;

    let palletBoxes = 0;
    let palletGrossKg = 0;
    const palletSkus: Array<{ item: OrderItem; qty: number }> = [];

    for (const item of sorted) {
      const rem = remaining.get(item.productCode) ?? 0;
      if (rem === 0) continue;
      const countHeadroom = MAX_PUMP_BOXES_PER_PALLET - palletBoxes;
      const weightHeadroom = MAX_PALLET_GROSS_KG - woodReserveKg - palletGrossKg;
      if (countHeadroom <= 0 || weightHeadroom <= 0) break;
      const qtyThisPallet = Math.min(rem, countHeadroom, Math.floor(weightHeadroom / item.grossWeightKg));
      if (qtyThisPallet <= 0) continue;
      palletSkus.push({ item, qty: qtyThisPallet });
      palletBoxes += qtyThisPallet;
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
  // The 1500kg limit is for the whole pallet, wood included
  const woodReserveKg = Math.max(...items.map(i => resolveWoodWeight(i, true)));

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
      const weightHeadroom = MAX_PALLET_GROSS_KG - woodReserveKg - palletGrossKg;
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
    // Mixed pallets are as long as their longest motor box
    const longestItem = palletSkus.reduce((a, b) =>
      b.item.boxLengthMm > a.item.boxLengthMm ? b : a
    ).item;
    const { lengthMm, widthMm, heightMm } = computeMotorPalletGeometry(longestItem, totalQty);
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

// ─── Stacking ────────────────────────────────────────────────────────────────
// A pallet may go on top of another only if all of these hold
function canStack(bottom: PalletPlan, top: PalletPlan): boolean {
  return (
    top.lengthMm <= bottom.lengthMm &&                                 // fits within the
    top.widthMm <= bottom.widthMm &&                                   //   bottom footprint
    bottom.totalGrossKg >= top.totalGrossKg &&                         // heavier on the bottom
    bottom.heightMm + top.heightMm <= MAX_STACKED_HEIGHT_MM &&         // forklift clearance
    bottom.totalGrossKg + top.totalGrossKg <= MAX_STACKED_GROSS_KG &&  // forklift capacity
    (bottom.customer ?? '') === (top.customer ?? '')                   // consignees kept apart
  );
}

// Pairs pallets two-high. Heaviest pallets are tried as bottoms first; each
// takes the best top that passes canStack: same family first, then the one
// saving the most floor. A pallet is in at most one stack (no triple stacking).
export function stackPallets(pallets: PalletPlan[]): PalletPlan[] {
  const byWeight = [...pallets].sort((a, b) => b.totalGrossKg - a.totalGrossKg);
  const partner = new Map<string, { id: string; position: 'bottom' | 'top' }>();

  for (const bottom of byWeight) {
    if (partner.has(bottom.palletId)) continue;
    let best: PalletPlan | null = null;
    for (const top of byWeight) {
      if (top === bottom || partner.has(top.palletId) || !canStack(bottom, top)) continue;
      const sameFamily = (p: PalletPlan) => p.family === bottom.family;
      const better = !best
        || (sameFamily(top) && !sameFamily(best))
        || (sameFamily(top) === sameFamily(best) && top.lengthMm * top.widthMm > best.lengthMm * best.widthMm);
      if (better) best = top;
    }
    if (!best) continue;
    partner.set(bottom.palletId, { id: best.palletId, position: 'bottom' });
    partner.set(best.palletId, { id: bottom.palletId, position: 'top' });
  }

  return pallets.map(p => {
    const pair = partner.get(p.palletId);
    return pair ? { ...p, isStacked: true, stackedWith: pair.id, stackPosition: pair.position } : p;
  });
}

function fitsFloor(pallets: PalletPlan[], containerLength: number): boolean {
  return packPallets(pallets, containerLength).every(p => !p.overflow);
}

export function computeShipment(items: OrderItem[]): ShipmentResult {
  // Pallets start unstacked; stacking is used only if the floor needs it
  const built = buildPalletPlans(items);
  let pallets = built;
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

  // Container decision order: 20ft flat → 20ft stacked → 40ft flat →
  // 40ft stacked → multiple containers. Each size must also pass its CBM and
  // payload limits; a pallet longer than a 20ft rules the 20ft out.
  let containerRecommendation: ShipmentResult['containerRecommendation'];
  let containersNeeded: number | undefined;
  const len20 = CONTAINER_LENGTH_MM.FCL_20FT;
  const len40 = CONTAINER_LENGTH_MM.FCL_40FT;
  const allows20ft = !requires40ft && totalCBM <= CONTAINERS.FCL_20FT.maxCBM && totalGrossKg <= CONTAINERS.FCL_20FT.maxPayloadKg;
  const allows40ft = totalCBM <= CONTAINERS.FCL_40FT.maxCBM && totalGrossKg <= CONTAINERS.FCL_40FT.maxPayloadKg;
  const stacked = stackPallets(built);
  const applyStacking = (size: string) => {
    pallets = stacked;
    const pairs = stacked.filter(p => p.stackPosition === 'bottom').length;
    warnings.push(`${pairs} stacked pair${pairs === 1 ? '' : 's'} needed to fit a ${size} — pallets stacked two-high, confirm with Mahendra before loading`);
  };

  // SLEKA books one full container per customer, so LCL only for a single
  // small pallet; 2+ pallets always get FCL regardless of volume
  if (built.length <= 1 && totalCBM < 2.0) {
    containerRecommendation = 'LCL';
    warnings.push('LCL recommended — volume too small for FCL. Consolidation charges will apply.');
  } else if (allows20ft) {
    containerRecommendation = 'FCL_20FT';
  } else if (allows40ft) {
    containerRecommendation = 'FCL_40FT';
  } else {
    containerRecommendation = 'MULTI_CONTAINER';
    pallets = stacked;
    const containersByVolume = Math.ceil(totalCBM / CONTAINERS.FCL_40FT.maxCBM);
    const containersByWeight = Math.ceil(totalGrossKg / CONTAINERS.FCL_40FT.maxPayloadKg);
    containersNeeded = Math.max(containersByVolume, containersByWeight);
    const limitingFactor = containersByWeight > containersByVolume ? 'weight' : 'volume';
    warnings.push(`Requires ~${containersNeeded} × 40ft FCL — limited by ${limitingFactor}.`);
  }

  // The container is chosen by CBM, payload and pallet length only (the strip
  // packer is simpler than a real loading plan). If the drawn floor plan doesn't
  // fit flat, safe stacks are used to tighten it and the plan is flagged.
  if (containerRecommendation === 'FCL_20FT' || containerRecommendation === 'FCL_40FT') {
    const length = containerRecommendation === 'FCL_20FT' ? len20 : len40;
    const size = containerRecommendation === 'FCL_20FT' ? '20ft' : '40ft';
    if (!fitsFloor(built, length)) {
      if (fitsFloor(stacked, length)) {
        applyStacking(size);
      } else {
        const overflowOf = (ps: PalletPlan[]) => packPallets(ps, length).filter(p => p.overflow).length;
        const useStacks = overflowOf(stacked) < overflowOf(built);
        if (useStacks) pallets = stacked;
        const pairs = stacked.filter(p => p.stackPosition === 'bottom').length;
        warnings.push(
          `Floor plan is approximate — the auto layout doesn't fit every pallet on a ${size} floor` +
          (useStacks ? ` even with ${pairs} safe stacked pair${pairs === 1 ? '' : 's'}` : '') +
          '. Confirm the loading plan with Mahendra.'
        );
      }
    }
  }

  if (containerRecommendation === 'FCL_20FT') {
    const u = totalGrossKg / CONTAINERS.FCL_20FT.maxPayloadKg;
    if (u > 0.9) warnings.push(`20ft payload at ${(u * 100).toFixed(0)}% — approaching limit`);
  }
  if (containerRecommendation === 'FCL_40FT') {
    const u = totalGrossKg / CONTAINERS.FCL_40FT.maxPayloadKg;
    if (u > 0.9) warnings.push(`40ft payload at ${(u * 100).toFixed(0)}% — approaching limit`);
  }

  // Floor positions in the recommended container, saved with the result so
  // a reloaded calculation draws exactly this plan
  const placed = containerRecommendation === 'LCL'
    ? []
    : packPallets(pallets, containerRecommendation === 'FCL_20FT' ? len20 : len40);

  return {
    pallets,
    placed,
    totalCBM: Math.round(totalCBM * 1000) / 1000,
    totalGrossKg: Math.round(totalGrossKg * 10) / 10,
    containerRecommendation,
    ...(containersNeeded !== undefined && { containersNeeded }),
    warnings,
  };
}