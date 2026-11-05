import {
  OrderItem,
  PalletPlan,
  PlacedPallet,
  ShipmentResult,
} from '@/lib/types';
import {
  CONTAINERS,
  PUMP_PALLET_WIDTH,
  MOTOR_PALLET_WIDTH,
  WOOD_WEIGHT,
  MAX_STACK_HEIGHT_MM,
  PALLET_BASE_HEIGHT_MM,
  MAX_PALLET_GROSS_KG,
  MAX_PUMP_PALLET_LENGTH_MM,
  LCL_SUGGEST_BELOW_KG,
} from '@/lib/constants';
import { packPallets } from '@/lib/engine/floorPlan';

// Container inner dimensions (mm)
export const CONTAINER_INNER_20FT = { lengthMm: 5898, widthMm: 2352, heightMm: 2393 };
export const CONTAINER_INNER_40FT = { lengthMm: 12032, widthMm: 2352, heightMm: 2393 };
export const CONTAINER_INNER_40HC = { lengthMm: 12032, widthMm: 2352, heightMm: 2698 };

// Stacked pair height cap, pending the loading team's forklift clearance check
const MAX_STACKED_HEIGHT_MM = 2200;

// Pumps share a pallet only if their tube lengths are within this of each other
const TUBE_LENGTH_TOLERANCE_MM = 50;

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
  const heavyFamilies = ['SK77', 'SK95'];
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
  const key = `${customer}::${category}::w${palletWidthMm}`;
  // Different tube faces don't stack cleanly, even on the same pallet width
  return item.productType === 'pump' ? `${key}::f${item.boxWidthMm}x${item.boxHeightMm}` : key;
}

// Splits items into runs of similar tube length, longest first. Each run spans at
// most the tolerance, so every pair in it is within the tolerance of each other.
function splitByTubeLength(items: OrderItem[]): OrderItem[][] {
  const runs: OrderItem[][] = [];
  for (const item of [...items].sort((a, b) => b.boxLengthMm - a.boxLengthMm)) {
    const run = runs[runs.length - 1];
    if (run && run[0].boxLengthMm - item.boxLengthMm <= TUBE_LENGTH_TOLERANCE_MM) run.push(item);
    else runs.push([item]);
  }
  return runs;
}

function groupGrossKg(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + i.grossWeightKg * i.quantity, 0);
}

function buildPumpPallets(
  items: OrderItem[],
  palletCounter: { value: number }
): PalletPlan[] {
  const MAX_PUMP_BOXES_PER_PALLET = 30;
  const pallets: PalletPlan[] = [];
  // Heaviest box first
  const sorted = [...items].sort((a, b) => b.grossWeightKg - a.grossWeightKg);
  const remaining = new Map<string, number>(
    sorted.map(item => [item.productCode, item.quantity])
  );
  // The pallet weight limit is for the whole pallet, wood included
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
  // The pallet weight limit is for the whole pallet, wood included
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

  // A product code entered on several lines is one line with the summed
  // quantity (other fields from its first line); kept apart per customer
  const merged = new Map<string, OrderItem>();
  for (const item of items) {
    const key = `${item.customer ?? 'default'}::${item.productCode}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += item.quantity;
    else merged.set(key, { ...item });
  }

  for (const item of Array.from(merged.values())) {
    const key = consolidationKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const finalGroups = Array.from(groups.values())
    .flatMap(g => (g[0].productType === 'pump' ? splitByTubeLength(g) : [g]))
    // Heaviest group first, so the biggest pumps are placed before smaller ones
    .sort((a, b) => groupGrossKg(b) - groupGrossKg(a));

  for (const groupItems of finalGroups) {
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
    bottom.totalGrossKg <= MAX_PALLET_GROSS_KG &&                      // each pallet within its
    top.totalGrossKg <= MAX_PALLET_GROSS_KG &&                         //   own weight limit
    (bottom.customer ?? '') === (top.customer ?? '')                   // consignees kept apart
  );
}

// Pairs pallets two-high. Heaviest pallets are tried as bottoms first; each
// takes the best top that passes canStack: same family first, then the one
// saving the most floor. A pallet is in at most one stack (no triple stacking).
// Stops after maxPairs pairs.
export function stackPallets(pallets: PalletPlan[], maxPairs = Infinity): PalletPlan[] {
  const byWeight = [...pallets].sort((a, b) => b.totalGrossKg - a.totalGrossKg);
  const partner = new Map<string, { id: string; position: 'bottom' | 'top' }>();
  let pairs = 0;

  for (const bottom of byWeight) {
    if (pairs >= maxPairs) break;
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
    pairs++;
  }

  return pallets.map(p => {
    const pair = partner.get(p.palletId);
    return pair ? { ...p, isStacked: true, stackedWith: pair.id, stackPosition: pair.position } : p;
  });
}

function fitsFloor(pallets: PalletPlan[], containerLength: number): boolean {
  return packPallets(pallets, containerLength).every(p => !p.overflow);
}

const FCL_OPTIONS = [
  { key: 'FCL_20FT', label: '20ft', inner: CONTAINER_INNER_20FT, limits: CONTAINERS.FCL_20FT },
  { key: 'FCL_40FT', label: '40ft', inner: CONTAINER_INNER_40FT, limits: CONTAINERS.FCL_40FT },
] as const;
type FclOption = (typeof FCL_OPTIONS)[number];

function stackedPairCount(pallets: PalletPlan[]): number {
  return pallets.filter(p => p.stackPosition === 'bottom').length;
}

// The pallets as they load into this container: flat if the floor holds them,
// otherwise with only as many stacked pairs as the floor needs. Null when the
// container is disqualified.
function fitContainer(
  built: PalletPlan[],
  option: FclOption,
  totalCBM: number,
  totalGrossKg: number,
): PalletPlan[] | null {
  if (built.some(p => p.lengthMm > option.inner.lengthMm)) return null;
  if (totalCBM > option.limits.maxCBM || totalGrossKg > option.limits.maxPayloadKg) return null;
  if (fitsFloor(built, option.inner.lengthMm)) return built;
  const possiblePairs = stackedPairCount(stackPallets(built));
  for (let pairs = 1; pairs <= possiblePairs; pairs++) {
    const stacked = stackPallets(built, pairs);
    if (fitsFloor(stacked, option.inner.lengthMm)) return stacked;
  }
  return null;
}

// Fills 40ft containers one at a time, each within its floor, CBM and payload
// limits. Every pallet passed in must fit a 40ft on its own.
function loadInto40ftContainers(pallets: PalletPlan[]): PlacedPallet[][] {
  const { inner, limits } = FCL_OPTIONS[1];
  const loads: PlacedPallet[][] = [];
  let remaining = pallets;
  while (remaining.length > 0) {
    const load: PlacedPallet[] = [];
    let cbm = 0;
    let grossKg = 0;
    for (const placed of packPallets(remaining, inner.lengthMm)) {
      const unit = placed.stackedPallet ? [placed.pallet, placed.stackedPallet] : [placed.pallet];
      const unitCbm = unit.reduce((s, p) => s + p.cbm, 0);
      const unitKg = unit.reduce((s, p) => s + p.totalGrossKg, 0);
      const overLimit = load.length > 0 && (cbm + unitCbm > limits.maxCBM || grossKg + unitKg > limits.maxPayloadKg);
      if (placed.overflow || overLimit) break;
      load.push(placed);
      cbm += unitCbm;
      grossKg += unitKg;
    }
    loads.push(load);
    const loaded = new Set(load.flatMap(p => [p.pallet.palletId, p.stackedPallet?.palletId]));
    remaining = remaining.filter(p => !loaded.has(p.palletId));
  }
  return loads;
}

export function computeShipment(items: OrderItem[]): ShipmentResult {
  // Pallets start unstacked; stacking is used only if the floor needs it
  const built = buildPalletPlans(items);
  let pallets = built;
  const warnings: string[] = [];
  const totalCBM = pallets.reduce((sum, p) => sum + p.cbm, 0);
  const totalGrossKg = pallets.reduce((sum, p) => sum + p.totalGrossKg, 0);

  pallets.forEach((p) => {
    if (p.heightMm > MAX_STACK_HEIGHT_MM) {
      warnings.push(`${p.palletId}: height ${p.heightMm}mm exceeds max stack height ${MAX_STACK_HEIGHT_MM}mm`);
    }
    if (p.lengthMm > CONTAINER_INNER_40FT.lengthMm) {
      warnings.push(`${p.palletId}: length ${p.lengthMm}mm exceeds 40ft inner length — no container fits it, arrange this pallet separately`);
    } else if (p.lengthMm > CONTAINER_INNER_20FT.lengthMm) {
      warnings.push(`${p.palletId}: length ${p.lengthMm}mm exceeds 20ft internal length — requires 40ft container`);
    }
    if (p.lengthMm > MAX_PUMP_PALLET_LENGTH_MM) {
      warnings.push(`${p.palletId}: length ${p.lengthMm}mm exceeds practical pallet limit (${MAX_PUMP_PALLET_LENGTH_MM}mm) — verify floor-plan with Mahendra`);
    }
    if (p.totalGrossKg > MAX_PALLET_GROSS_KG) {
      warnings.push(`${p.palletId}: gross weight ${p.totalGrossKg}kg — verify forklift capacity`);
    }
  });

  // Container decision order: 20ft flat → 20ft stacked → 40ft flat → 40ft stacked
  // → multiple containers. The first size whose floor, CBM and payload all hold wins.
  let chosen: FclOption | null = null;
  let chosenPallets: PalletPlan[] | null = null;
  for (const option of FCL_OPTIONS) {
    chosenPallets = fitContainer(built, option, totalCBM, totalGrossKg);
    if (chosenPallets) {
      chosen = option;
      break;
    }
  }

  // LCL rules look at pallet length, CBM and payload only, not the floor
  const allows20ft =
    built.every(p => p.lengthMm <= CONTAINER_INNER_20FT.lengthMm) &&
    totalCBM <= CONTAINERS.FCL_20FT.maxCBM &&
    totalGrossKg <= CONTAINERS.FCL_20FT.maxPayloadKg;

  let containerRecommendation: ShipmentResult['containerRecommendation'];
  let containersNeeded: number | undefined;
  let containerLoads: ShipmentResult['containerLoads'];
  let placed: PlacedPallet[] = [];
  const warnStackedPairs = (size: string) => {
    const pairs = stackedPairCount(pallets);
    if (pairs > 0) {
      warnings.push(`${pairs} stacked pair${pairs === 1 ? '' : 's'} needed to fit a ${size} — pallets stacked two-high, confirm with Mahendra before loading`);
    }
  };

  if (built.length <= 1 && totalCBM < 2.0) {
    containerRecommendation = 'LCL';
    warnings.push('LCL recommended — volume too small for FCL. Consolidation charges will apply.');
  } else if (allows20ft && totalGrossKg < LCL_SUGGEST_BELOW_KG) {
    containerRecommendation = 'LCL';
    warnings.push(
      `LCL recommended — total gross weight ${Math.round(totalGrossKg).toLocaleString('en-US')} kg is under ` +
      `${LCL_SUGGEST_BELOW_KG.toLocaleString('en-US')} kg. If booked as FCL instead, ` +
      (chosen ? `it fits a ${chosen.label} container.` : 'it needs more than one 40ft container.')
    );
  } else if (chosen && chosenPallets) {
    containerRecommendation = chosen.key;
    pallets = chosenPallets;
    placed = packPallets(pallets, chosen.inner.lengthMm);
    warnStackedPairs(chosen.label);
    const payloadUse = totalGrossKg / chosen.limits.maxPayloadKg;
    if (payloadUse > 0.9) {
      warnings.push(`${chosen.label} payload at ${(payloadUse * 100).toFixed(0)}% — approaching limit`);
    }
  } else {
    containerRecommendation = 'MULTI_CONTAINER';
    // A pallet too long for any container can't join a load or a stack
    const loadable = built.filter(p => p.lengthMm <= CONTAINER_INNER_40FT.lengthMm);
    const tooLong = built.filter(p => p.lengthMm > CONTAINER_INNER_40FT.lengthMm);
    // Fewest stacked pairs that still reach the lowest container count
    const lowestCount = loadInto40ftContainers(stackPallets(loadable)).length;
    let stacked = loadable;
    let loads = loadInto40ftContainers(stacked);
    for (let pairs = 1; loads.length > lowestCount; pairs++) {
      stacked = stackPallets(loadable, pairs);
      loads = loadInto40ftContainers(stacked);
    }
    pallets = [...stacked, ...tooLong];
    // Only the first container is drawn; the floor plan labels it as such
    placed = loads[0] ?? [];
    containerLoads = loads.map(load => {
      const loaded = load.flatMap(p => (p.stackedPallet ? [p.pallet, p.stackedPallet] : [p.pallet]));
      return {
        palletIds: loaded.map(p => p.palletId),
        cbm: Math.round(loaded.reduce((sum, p) => sum + p.cbm, 0) * 1000) / 1000,
        grossKg: Math.round(loaded.reduce((sum, p) => sum + p.totalGrossKg, 0) * 10) / 10,
      };
    });
    const containersByVolume = Math.ceil(totalCBM / CONTAINERS.FCL_40FT.maxCBM);
    const containersByWeight = Math.ceil(totalGrossKg / CONTAINERS.FCL_40FT.maxPayloadKg);
    containersNeeded = Math.max(loads.length, 1);
    const limitingFactor = loads.length > Math.max(containersByVolume, containersByWeight)
      ? 'floor space'
      : containersByWeight > containersByVolume ? 'weight' : 'volume';
    warnings.push(`Requires ~${containersNeeded} × 40ft FCL — limited by ${limitingFactor}.`);
    warnStackedPairs('40ft');
  }

  return {
    pallets,
    placed,
    totalCBM: Math.round(totalCBM * 1000) / 1000,
    totalGrossKg: Math.round(totalGrossKg * 10) / 10,
    containerRecommendation,
    ...(containersNeeded !== undefined && { containersNeeded }),
    ...(containerLoads !== undefined && { containerLoads }),
    warnings,
  };
}
