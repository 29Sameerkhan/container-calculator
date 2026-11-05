import {
  OrderItem,
  PalletLayer,
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

// Layered pallet height limit, wood base included
const MAX_LAYERED_PALLET_HEIGHT_MM = 2200;
const MAX_MOTORS_PER_PALLET = 24;

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

type PalletSku = { item: OrderItem; qty: number };

// A pallet being built, before it gets its ID and final figures
interface PalletDraft {
  skus: PalletSku[];  // bottom layer first
  widthMm: number;
  motorOnly: boolean;
}

function buildLayers(skus: PalletSku[], widthMm: number): PalletLayer[] {
  return skus.map(({ item, qty }) => {
    const boxesAcross = Math.max(1, Math.floor(widthMm / item.boxWidthMm));
    const rows = Math.ceil(qty / boxesAcross);
    return {
      productCode: item.productCode,
      quantity: qty,
      boxesAcross,
      rows,
      lengthMm: item.boxLengthMm,
      heightMm: rows * item.boxHeightMm,
      grossWeightKg: Math.round(item.grossWeightKg * qty * 10) / 10,
    };
  });
}

function layeredHeightMm(skus: PalletSku[], widthMm: number): number {
  return buildLayers(skus, widthMm).reduce((sum, l) => sum + l.heightMm, PALLET_BASE_HEIGHT_MM);
}

function longestBoxMm(skus: PalletSku[]): number {
  return Math.max(...skus.map(s => s.item.boxLengthMm));
}

function boxCount(skus: PalletSku[]): number {
  return skus.reduce((sum, s) => sum + s.qty, 0);
}

function boxesGrossKg(skus: PalletSku[]): number {
  return skus.reduce((sum, s) => sum + s.item.grossWeightKg * s.qty, 0);
}

function woodKg(skus: PalletSku[]): number {
  return Math.max(...skus.map(s => resolveWoodWeight(s.item, skus.length > 1)));
}

function palletGrossKg(skus: PalletSku[]): number {
  return boxesGrossKg(skus) + woodKg(skus);
}

function consolidationKey(item: OrderItem): string {
  const palletWidthMm = resolvePalletWidth(item);
  const customer = item.customer ?? 'default';
  const category = isMotor(item) ? `motor-${item.productType}` : 'pump';
  return `${customer}::${category}::w${palletWidthMm}`;
}

function groupGrossKg(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + i.grossWeightKg * i.quantity, 0);
}

// Fills pallets from one pallet width pool, longest tube first. Each product is
// a layer on top of the last. A product is placed in full before the next one
// starts, moving to a new pallet only when weight or height runs out.
function buildPumpDrafts(items: OrderItem[]): PalletDraft[] {
  const drafts: PalletDraft[] = [];
  const widthMm = resolvePalletWidth(items[0]);
  const sorted = [...items].sort((a, b) =>
    b.boxLengthMm - a.boxLengthMm || b.grossWeightKg - a.grossWeightKg
  );
  // The pallet weight limit is for the whole pallet, wood included
  const woodReserveKg = Math.max(...items.map(i => resolveWoodWeight(i, true)));

  let skus: PalletSku[] = [];
  let grossKg = 0;
  let heightMm = PALLET_BASE_HEIGHT_MM;
  const closePallet = () => {
    drafts.push({ skus, widthMm, motorOnly: false });
    skus = [];
    grossKg = 0;
    heightMm = PALLET_BASE_HEIGHT_MM;
  };

  for (const item of sorted) {
    const boxesAcross = Math.max(1, Math.floor(widthMm / item.boxWidthMm));
    let remaining = item.quantity;
    while (remaining > 0) {
      const fits = Math.min(
        Math.floor((MAX_PALLET_GROSS_KG - woodReserveKg - grossKg) / item.grossWeightKg),
        Math.floor((MAX_LAYERED_PALLET_HEIGHT_MM - heightMm) / item.boxHeightMm) * boxesAcross,
      );
      if (fits <= 0 && skus.length > 0) {
        closePallet();
        continue;
      }
      // A single box over a limit still gets a pallet of its own
      const qty = fits <= 0 ? 1 : Math.min(remaining, fits);
      skus.push({ item, qty });
      grossKg += qty * item.grossWeightKg;
      heightMm += Math.ceil(qty / boxesAcross) * item.boxHeightMm;
      remaining -= qty;
      if (remaining > 0) closePallet();
    }
  }
  if (skus.length > 0) closePallet();
  return drafts;
}

function buildMotorDrafts(items: OrderItem[]): PalletDraft[] {
  const drafts: PalletDraft[] = [];
  const widthMm = resolvePalletWidth(items[0]);
  const remaining = new Map<string, number>(items.map(item => [item.productCode, item.quantity]));
  const sorted = [...items].sort((a, b) => b.quantity - a.quantity);
  // The pallet weight limit is for the whole pallet, wood included
  const woodReserveKg = Math.max(...items.map(i => resolveWoodWeight(i, true)));

  while (Array.from(remaining.values()).some(q => q > 0)) {
    const skus: PalletSku[] = [];
    let motors = 0;
    let grossKg = 0;

    for (const item of sorted) {
      const rem = remaining.get(item.productCode) ?? 0;
      if (rem === 0) continue;
      const qty = Math.min(
        rem,
        MAX_MOTORS_PER_PALLET - motors,
        Math.floor((MAX_PALLET_GROSS_KG - woodReserveKg - grossKg) / item.grossWeightKg),
      );
      if (qty <= 0) continue;
      skus.push({ item, qty });
      motors += qty;
      grossKg += qty * item.grossWeightKg;
      remaining.set(item.productCode, rem - qty);
    }

    // A single box over a limit still gets a pallet of its own
    if (skus.length === 0) {
      const item = sorted.find(i => (remaining.get(i.productCode) ?? 0) > 0)!;
      skus.push({ item, qty: 1 });
      remaining.set(item.productCode, (remaining.get(item.productCode) ?? 1) - 1);
    }
    drafts.push({ skus, widthMm, motorOnly: true });
  }
  return drafts;
}

function sameCustomer(a: PalletDraft, b: PalletDraft): boolean {
  return (a.skus[0].item.customer ?? '') === (b.skus[0].item.customer ?? '');
}

function isPumpDraft(d: PalletDraft): boolean {
  return d.skus.every(s => s.item.productType === 'pump');
}

// Whether a small pallet's boxes fit as new layers on top of another pallet.
// None may be longer than the layer they would sit on.
function canAbsorb(host: PalletDraft, guest: PalletDraft, widthMm: number): boolean {
  const combined = [...host.skus, ...guest.skus];
  return (
    longestBoxMm(guest.skus) <= host.skus[host.skus.length - 1].item.boxLengthMm &&
    palletGrossKg(combined) <= MAX_PALLET_GROSS_KG &&
    layeredHeightMm(combined, widthMm) <= MAX_LAYERED_PALLET_HEIGHT_MM
  );
}

// A pump pallet goes on top of another pump pallet, including one from another
// width pool, when it fits. The merged pallet takes the wider of the two widths.
function mergeSmallPumpPallets(drafts: PalletDraft[]): PalletDraft[] {
  let result = drafts;
  const longestFirst = [...drafts].sort((a, b) => longestBoxMm(b.skus) - longestBoxMm(a.skus));
  for (const guest of longestFirst) {
    if (!isPumpDraft(guest)) continue;
    const host = result
      .filter(d =>
        d !== guest &&
        isPumpDraft(d) &&
        sameCustomer(d, guest) &&
        canAbsorb(d, guest, Math.max(d.widthMm, guest.widthMm))
      )
      .sort((a, b) => palletGrossKg(b.skus) - palletGrossKg(a.skus))[0];
    if (!host) continue;
    host.skus = [...host.skus, ...guest.skus];
    host.widthMm = Math.max(host.widthMm, guest.widthMm);
    result = result.filter(d => d !== guest);
  }
  return result;
}

// Motor pallets go on top of a pump pallet when they fit. Returns the motor
// pallets that still stand on their own.
function mergeSmallMotorPallets(motors: PalletDraft[], pumps: PalletDraft[]): PalletDraft[] {
  return motors.filter(guest => {
    const host = pumps
      .filter(d =>
        d.skus[0].item.productType === 'pump' &&
        sameCustomer(d, guest) &&
        guest.skus.every(s => s.item.boxWidthMm <= d.widthMm) &&
        canAbsorb(d, guest, d.widthMm)
      )
      .sort((a, b) => palletGrossKg(b.skus) - palletGrossKg(a.skus))[0];
    if (!host) return true;
    const longestFirst = [...guest.skus].sort((a, b) => b.item.boxLengthMm - a.item.boxLengthMm);
    host.skus = [...host.skus, ...longestFirst];
    return false;
  });
}


function finalizePallet(draft: PalletDraft, index: number): PalletPlan {
  const { skus, widthMm, motorOnly } = draft;
  const totalQty = boxCount(skus);
  const bottom = skus[0].item;
  let lengthMm: number;
  let heightMm: number;
  let layers: PalletLayer[] | undefined;
  if (motorOnly) {
    // Mixed pallets are as long as their longest motor box
    const longest = skus.reduce((a, b) => (b.item.boxLengthMm > a.item.boxLengthMm ? b : a)).item;
    ({ lengthMm, heightMm } = computeMotorPalletGeometry(longest, totalQty));
  } else {
    layers = buildLayers(skus, widthMm);
    lengthMm = longestBoxMm(skus);
    heightMm = layeredHeightMm(skus, widthMm);
  }
  const grossKg = boxesGrossKg(skus);
  const woodWeightKg = woodKg(skus);
  const totalNetKg = skus.reduce((sum, { item, qty }) => sum + item.netWeightKg * qty, 0);
  const cbm = (lengthMm * widthMm * heightMm) / 1_000_000_000;

  return {
    palletId: `SK-${String(index + 1).padStart(2, '0')}`,
    family: bottom.palletFamily,
    productCode: bottom.productCode,
    productCodes: skus.map(s => s.item.productCode),
    quantity: totalQty,
    skuBreakdown: skus.map(s => ({
      productCode: s.item.productCode,
      quantity: s.qty,
      netWeightKg: Math.round(s.item.netWeightKg * s.qty * 10) / 10,
      grossWeightKg: Math.round(s.item.grossWeightKg * s.qty * 10) / 10,
    })),
    ...(layers && { layers }),
    lengthMm,
    widthMm,
    heightMm,
    cbm: Math.round(cbm * 1000) / 1000,
    netWeightKg: Math.round(totalNetKg * 10) / 10,
    grossWeightKg: Math.round(grossKg * 10) / 10,
    woodWeightKg,
    totalGrossKg: Math.round((grossKg + woodWeightKg) * 10) / 10,
    isMixedSku: skus.length > 1,
    customer: bottom.customer,
  };
}

export function buildPalletPlans(items: OrderItem[]): PalletPlan[] {
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

  // Heaviest group first, so the biggest pumps are placed before smaller ones
  const sortedGroups = Array.from(groups.values()).sort((a, b) => groupGrossKg(b) - groupGrossKg(a));

  // All pump pallets first, then motors, which may finish on top of a pump pallet
  const pumps = mergeSmallPumpPallets(
    sortedGroups.filter(g => !isMotor(g[0])).flatMap(buildPumpDrafts)
  );
  const motors = mergeSmallMotorPallets(
    sortedGroups.filter(g => isMotor(g[0])).flatMap(buildMotorDrafts),
    pumps,
  );

  return [...pumps, ...motors].map(finalizePallet);
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
