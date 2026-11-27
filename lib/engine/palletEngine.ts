import {
  OrderItem,
  PalletLayer,
  PalletPlan,
  PlacedPallet,
  PresetConfig,
  RulePreset,
  ShipmentResult,
} from '@/lib/types';
import {
  CONTAINERS,
  PUMP_PALLET_FAMILIES,
  MOTORS_PER_ROW,
  WOOD_WEIGHT,
  PALLET_BASE_HEIGHT_MM,
  MAX_PUMP_PALLET_LENGTH_MM,
  LCL_SUGGEST_BELOW_KG,
  CRATE_MAX_QTY,
  CRATE_MAX_GROSS_KG,
  CRATE_WALL_MM,
  PRESET_CONFIGS,
  DEFAULT_PRESET,
} from '@/lib/constants';
import { packPallets, packPalletsTurning } from '@/lib/engine/floorPlan';
import { stackingProblem } from '@/lib/engine/stacking';
import { normaliseProductCode } from '@/lib/engine/utils';

// Container inner dimensions (mm)
export const CONTAINER_INNER_20FT = { lengthMm: 5898, widthMm: 2352, heightMm: 2393 };
export const CONTAINER_INNER_40FT = { lengthMm: 12032, widthMm: 2352, heightMm: 2393 };
export const CONTAINER_INNER_40HC = { lengthMm: 12032, widthMm: 2352, heightMm: 2698 };


// Pumps from different pools share a pallet only if their pool widths are this close
const MAX_CROSS_POOL_WIDTH_GAP_MM = 100;

// Leftover clubbing (Mahendra's rule): small pallets of these two face sizes may share a pallet
const CLUB_MAX_BOXES = 15;
const CLUB_FACE_SIZES_MM = [100, 152];

// Pallet width, height and weight limits come from the rule preset. Every helper
// takes the config explicitly; callers that pass none get the Standard rules.
const STANDARD = PRESET_CONFIGS.standard;

function isMotor(item: OrderItem): boolean {
  return item.productType.startsWith('motor-');
}



export function resolvePalletWidth(item: OrderItem, cfg: PresetConfig = STANDARD): number {
  // One motor pallet width for every series (standardised per Kiran sir, 19 Nov 2026)
  if (isMotor(item)) return cfg.motorPalletWidthMm;
  if (item.productType === 'controller' || item.productType === 'spare') {
    console.warn('Controller/spare pallet width defaulting to 715mm — confirm with Mahendra');
    return 715;
  }
  if (!PUMP_PALLET_FAMILIES.includes(item.palletFamily)) {
    throw new Error(`Unknown pallet family: ${item.palletFamily}`);
  }
  // One pump pallet width for every family (standardised per Kiran sir, 19 Nov 2026)
  return cfg.pumpPalletWidthMm;
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
  qty: number,
  cfg: PresetConfig = STANDARD,
): { lengthMm: number; widthMm: number; heightMm: number; motorsPerLayer: number; layers: number } {
  const palletWidthMm = resolvePalletWidth(item, cfg);
  // Always 3 motors across, whatever the box width (Kiran sir, 19 Nov 2026)
  const motorsPerLayer = cfg.motorsPerRow;
  const rowHeightMm = motorRowHeightMm(item, cfg);
  // Motor pallet height cap is total from floor, wood base included
  const maxLayers = Math.floor((cfg.maxMotorTotalHeightMm - PALLET_BASE_HEIGHT_MM) / rowHeightMm);
  const layers = Math.max(1, Math.min(maxLayers, Math.ceil(qty / motorsPerLayer)));
  const columns = Math.ceil(qty / (motorsPerLayer * layers));
  const lengthMm = columns * item.boxLengthMm;
  const heightMm = layers * rowHeightMm + PALLET_BASE_HEIGHT_MM;
  return { lengthMm, widthMm: palletWidthMm, heightMm, motorsPerLayer, layers };
}

// Height of one row of motor boxes on a motor-only pallet. Boxes stand upright
// (box height). A preset with a motors-per-pallet target lays them on their side
// when only that reaches the target within the height cap and still fits the
// row across the pallet: V6 boxes (178 × 229) on a 725mm Freepack pallet give
// 3 across × 8 rows at 1,604mm, as the factory packs them.
function motorRowHeightMm(item: OrderItem, cfg: PresetConfig): number {
  if (!Number.isFinite(cfg.motorQtyPerPallet)) return item.boxHeightMm;
  const rowsNeeded = Math.ceil(cfg.motorQtyPerPallet / cfg.motorsPerRow);
  const widthMm = resolvePalletWidth(item, cfg);
  const fits = (rowHeightMm: number, acrossMm: number) =>
    cfg.motorsPerRow * acrossMm <= widthMm &&
    rowsNeeded * rowHeightMm + PALLET_BASE_HEIGHT_MM <= cfg.maxMotorTotalHeightMm;
  if (fits(item.boxHeightMm, item.boxWidthMm)) return item.boxHeightMm;
  if (fits(item.boxWidthMm, item.boxHeightMm)) return item.boxWidthMm;
  return item.boxHeightMm;
}

type PalletSku = { item: OrderItem; qty: number };

// A pallet being built, before it gets its ID and final figures
interface PalletDraft {
  skus: PalletSku[];  // bottom layer first
  widthMm: number;
  motorOnly: boolean;
  sharedRows?: boolean;  // pump layers may share a part-filled row (Freepack fill)
  crate?: boolean;       // a wooden crate of loose motor boxes
}

// Boxes side-by-side across a pallet of this width. Motors are always
// MOTORS_PER_ROW across, on a pump pallet too (Kiran sir, 19 Nov 2026).
function boxesAcrossFor(item: OrderItem, widthMm: number): number {
  if (isMotor(item)) return MOTORS_PER_ROW;
  return Math.max(1, Math.floor(widthMm / item.boxWidthMm));
}

// Per Kiran sir (19 Nov 2026): different motor variants may share a row. A motor
// layer first fills the part-filled top row of the motor layer below it (up to
// MOTORS_PER_ROW across), then starts new rows. Pump rows are shared the same
// way only on a pallet packed with sharePumpRows (Freepack's fill), and only
// between boxes that sit the same number across.
function buildLayers(skus: PalletSku[], widthMm: number, sharePumpRows = false): PalletLayer[] {
  let openSlots = 0;        // free places in the top row of the layer below
  let openRowHeightMm = 0;  // that row's height; 0 when it can't be shared
  let openAcross = 0;       // boxes across that row
  return skus.map(({ item, qty }) => {
    const boxesAcross = boxesAcrossFor(item, widthMm);
    const shares = isMotor(item) || sharePumpRows;
    const sharedRowQty = shares && item.boxHeightMm <= openRowHeightMm && boxesAcross === openAcross
      ? Math.min(openSlots, qty)
      : 0;
    const rows = Math.ceil((qty - sharedRowQty) / boxesAcross);
    if (rows > 0) {
      openSlots = shares ? rows * boxesAcross - (qty - sharedRowQty) : 0;
      openRowHeightMm = shares ? item.boxHeightMm : 0;
      openAcross = boxesAcross;
    } else {
      openSlots -= sharedRowQty;
    }
    return {
      productCode: item.productCode,
      quantity: qty,
      boxesAcross,
      rows,
      ...(sharedRowQty > 0 && { sharedRowQty }),
      lengthMm: item.boxLengthMm,
      boxHeightMm: item.boxHeightMm,
      heightMm: rows * item.boxHeightMm,
      grossWeightKg: Math.round(item.grossWeightKg * qty * 10) / 10,
    };
  });
}

function layeredHeightMm(skus: PalletSku[], widthMm: number, sharePumpRows = false): number {
  return buildLayers(skus, widthMm, sharePumpRows).reduce((sum, l) => sum + l.heightMm, PALLET_BASE_HEIGHT_MM);
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

// Pumps with the same face size pool together whatever their pallet width.
// When the preset allows mixed families, every motor series shares one pool.
function consolidationKey(item: OrderItem, cfg: PresetConfig): string {
  const customer = item.customer ?? 'default';
  if (item.productType === 'pump') return `${customer}::pump::f${item.boxWidthMm}x${item.boxHeightMm}`;
  const category = isMotor(item) ? (cfg.allowCrossFamily ? 'motor' : `motor-${item.productType}`) : 'pump';
  return `${customer}::${category}::w${resolvePalletWidth(item, cfg)}`;
}

function groupGrossKg(items: OrderItem[]): number {
  return items.reduce((sum, i) => sum + i.grossWeightKg * i.quantity, 0);
}

// Per Mahendra: longest box always at bottom; weight is tiebreaker only.
function belongsBelow(below: OrderItem, above: OrderItem): boolean {
  return below.boxLengthMm > above.boxLengthMm ||
    (below.boxLengthMm === above.boxLengthMm && below.grossWeightKg >= above.grossWeightKg);
}

// Sort order for layers, bottom first.
// Per Mahendra: longest box always at bottom; weight is tiebreaker only.
function bottomLayerFirst(a: OrderItem, b: OrderItem): number {
  return b.boxLengthMm - a.boxLengthMm || b.grossWeightKg - a.grossWeightKg;
}

// Whether a layer may sit directly on the one below: in longest-at-bottom order,
// never a bigger face
function canSitOn(layer: PalletSku, below: PalletSku): boolean {
  return belongsBelow(below.item, layer.item) && layer.item.boxWidthMm <= below.item.boxWidthMm;
}

// Whether every pump in one group may share a pallet with every pump in the other
function poolsWithinGap(a: PalletSku[], b: PalletSku[], cfg: PresetConfig): boolean {
  return a.every(x => b.every(y =>
    Math.abs(resolvePalletWidth(x.item, cfg) - resolvePalletWidth(y.item, cfg)) <= MAX_CROSS_POOL_WIDTH_GAP_MM
  ));
}

// Whether these layers, bottom first, can make up one pallet of this width
function fitsOnePallet(skus: PalletSku[], widthMm: number, cfg: PresetConfig): boolean {
  return (
    skus.every((layer, i) => i === 0 || canSitOn(layer, skus[i - 1])) &&
    palletGrossKg(skus) <= cfg.maxPalletGrossKg &&
    longestBoxMm(skus) <= cfg.maxPalletLengthMm &&
    layeredHeightMm(skus, widthMm) <= cfg.maxPumpTotalHeightMm
  );
}

// Divides a quantity as evenly as possible, larger shares first
function evenShares(qty: number, parts: number): number[] {
  return Array.from({ length: parts }, (_, i) => Math.floor(qty / parts) + (i < qty % parts ? 1 : 0));
}

// A product that has to split over several pallets can carry the next product
// across all of them, when that product couldn't stay whole on the last pallet.
// Both are spread evenly. Returns the pallets, or null if the normal fill should be
// used instead.
function shareSplitPallets(
  lower: PalletSku,
  upper: PalletSku,
  pallets: number,
  fullPalletQty: number,
  cfg: PresetConfig,
): PalletSku[][] | null {
  const widthMm = Math.max(resolvePalletWidth(lower.item, cfg), resolvePalletWidth(upper.item, cfg));
  if (!poolsWithinGap([lower], [upper], cfg)) return null;
  const leftover = { item: lower.item, qty: lower.qty - (pallets - 1) * fullPalletQty };
  if (fitsOnePallet([leftover, upper], widthMm, cfg)) return null;

  const lowerShares = evenShares(lower.qty, pallets);
  const upperShares = evenShares(upper.qty, pallets);
  const shared = lowerShares.map((qty, i) => [
    { item: lower.item, qty },
    ...(upperShares[i] > 0 ? [{ item: upper.item, qty: upperShares[i] }] : []),
  ]);
  return shared.every(skus => fitsOnePallet(skus, widthMm, cfg)) ? shared : null;
}

// Fills pallets from one pool, longest tube first. Each product is a layer on top
// of the last, and a pallet is as wide as the widest product's pallet width on it.
// A product whose full quantity fits one pallet stays together, on a new pallet if
// it won't fit this one. A product too big for one pallet tops up this pallet only
// if that doesn't put it on an extra pallet, and may share its pallets with a
// shorter product (see shareSplitPallets).
function buildPumpDrafts(items: OrderItem[], cfg: PresetConfig): PalletDraft[] {
  const drafts: PalletDraft[] = [];
  // Per Mahendra: longest box always at bottom; weight is tiebreaker only.
  const sorted = [...items].sort(bottomLayerFirst);
  // The pallet weight limit is for the whole pallet, wood included
  const woodReserveKg = Math.max(...items.map(i => resolveWoodWeight(i, true)));

  let skus: PalletSku[] = [];
  let grossKg = 0;
  let palletWidthMm = 0;
  const closePallet = () => {
    drafts.push({ skus, widthMm: palletWidthMm, motorOnly: false });
    skus = [];
    grossKg = 0;
    palletWidthMm = 0;
  };

  const sharedAway = new Set<OrderItem>();

  sorted.forEach((item, index) => {
    if (sharedAway.has(item)) return;
    const itemWidthMm = resolvePalletWidth(item, cfg);
    const boxesFitting = (usedKg: number, usedHeightMm: number, widthMm: number) => Math.min(
      Math.floor((cfg.maxPalletGrossKg - woodReserveKg - usedKg) / item.grossWeightKg),
      Math.floor((cfg.maxPumpTotalHeightMm - usedHeightMm) / item.boxHeightMm) *
        boxesAcrossFor(item, widthMm),
    );
    // A single box over a limit still gets a pallet of its own
    const onNewPallet = Math.max(1, boxesFitting(0, PALLET_BASE_HEIGHT_MM, itemWidthMm));
    let remaining = item.quantity;

    while (remaining > 0) {
      if (skus.length === 0 && remaining > onNewPallet) {
        const lower = { item, qty: remaining };
        const pallets = Math.ceil(remaining / onNewPallet);
        const upper = sorted.slice(index + 1).find(i => !sharedAway.has(i));
        const shared = upper && shareSplitPallets(lower, { item: upper, qty: upper.quantity }, pallets, onNewPallet, cfg);
        if (upper && shared) {
          sharedAway.add(upper);
          const palletWidth = Math.max(itemWidthMm, resolvePalletWidth(upper, cfg));
          shared.slice(0, -1).forEach(p => drafts.push({ skus: p, widthMm: palletWidth, motorOnly: false }));
          // The last pallet stays open for more layers
          skus = shared[shared.length - 1];
          grossKg = boxesGrossKg(skus);
          palletWidthMm = palletWidth;
          remaining = 0;
          break;
        }
      }
      let qty = Math.min(remaining, onNewPallet);
      let widthMm = itemWidthMm;
      if (skus.length > 0) {
        const below = skus[skus.length - 1];
        widthMm = Math.max(palletWidthMm, itemWidthMm);
        const blocked = item.boxWidthMm > below.item.boxWidthMm || !poolsWithinGap(skus, [{ item, qty: 1 }], cfg);
        const fits = blocked ? 0 : boxesFitting(grossKg, layeredHeightMm(skus, widthMm), widthMm);
        const fitsWhole = remaining <= fits;
        const palletsIfNew = Math.ceil(remaining / onNewPallet);
        const palletsIfTopUp = 1 + Math.ceil((remaining - fits) / onNewPallet);
        const topUp = fits > 0 && remaining > onNewPallet && palletsIfTopUp <= palletsIfNew;
        if (!fitsWhole && !topUp) {
          closePallet();
          continue;
        }
        qty = Math.min(remaining, fits);
      }
      skus.push({ item, qty });
      grossKg += qty * item.grossWeightKg;
      palletWidthMm = widthMm;
      remaining -= qty;
      if (remaining > 0) closePallet();
    }
  });
  if (skus.length > 0) closePallet();
  return drafts;
}

// Freepack (factory-style) pump packing: every pump of the pool, longest first,
// fills the pallet box by box, sharing part-filled rows across products, until
// the next box would break the weight, height or length cap; then a new pallet.
// Products split across pallets freely. Factory benchmark: 7 across × 10 rows of
// 152mm boxes on a 1,110mm pallet, up to ~2,000kg.
function buildFilledPumpDrafts(items: OrderItem[], cfg: PresetConfig): PalletDraft[] {
  const drafts: PalletDraft[] = [];
  let skus: PalletSku[] = [];
  let palletWidthMm = 0;
  const close = () => {
    if (skus.length > 0) drafts.push({ skus, widthMm: palletWidthMm, motorOnly: false, sharedRows: true });
    skus = [];
    palletWidthMm = 0;
  };
  // Most of this item that still fits on the open pallet (monotone, so bisect).
  // A box longer than the length cap can't be helped: the pallet is then as long
  // as its bottom box (computeShipment warns), and still fills by weight and height.
  const mostThatFits = (item: OrderItem, widthMm: number, upTo: number) => {
    const maxLengthMm = Math.max(cfg.maxPalletLengthMm, (skus[0]?.item ?? item).boxLengthMm);
    const fits = (qty: number) => {
      const next = [...skus, { item, qty }];
      return palletGrossKg(next) <= cfg.maxPalletGrossKg &&
        longestBoxMm(next) <= maxLengthMm &&
        layeredHeightMm(next, widthMm, true) <= cfg.maxPumpTotalHeightMm;
    };
    let lo = 0;
    let hi = upTo;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  // Per Mahendra: longest box always at bottom; weight is tiebreaker only.
  for (const item of [...items].sort(bottomLayerFirst)) {
    let remaining = item.quantity;
    while (remaining > 0) {
      const below = skus[skus.length - 1];
      const widthMm = Math.max(palletWidthMm, resolvePalletWidth(item, cfg));
      const allowed = !below || canSitOn({ item, qty: 1 }, below);
      const qty = allowed ? mostThatFits(item, widthMm, remaining) : 0;
      if (qty === 0) {
        if (skus.length > 0) {
          close();
          continue;
        }
        // A single box over a limit still gets a pallet of its own
        skus = [{ item, qty: 1 }];
        palletWidthMm = widthMm;
        remaining -= 1;
        close();
        continue;
      }
      skus.push({ item, qty });
      palletWidthMm = widthMm;
      remaining -= qty;
      if (remaining > 0) close();
    }
  }
  close();
  return drafts;
}

// Freepack V4 motors: loose boxes in wooden crates, one variant per crate, up to
// CRATE_MAX_QTY boxes and CRATE_MAX_GROSS_KG gross each.
function buildCrateDrafts(items: OrderItem[]): PalletDraft[] {
  const drafts: PalletDraft[] = [];
  for (const item of items) {
    const perCrate = Math.max(1, Math.min(
      CRATE_MAX_QTY,
      Math.floor((CRATE_MAX_GROSS_KG - WOOD_WEIGHT.CRATE) / item.grossWeightKg),
    ));
    for (let left = item.quantity; left > 0; left -= perCrate) {
      drafts.push({ skus: [{ item, qty: Math.min(perCrate, left) }], widthMm: 0, motorOnly: true, crate: true });
    }
  }
  return drafts;
}

// Crate size around its boxes: boxes lie lengthwise, in a near-square block
// (40 boxes: 6 across × 7 high), plus CRATE_WALL_MM each side.
function crateGeometry(item: OrderItem, qty: number): { lengthMm: number; widthMm: number; heightMm: number } {
  const across = Math.max(1, Math.floor(Math.sqrt(qty)));
  const rows = Math.ceil(qty / across);
  return {
    lengthMm: item.boxLengthMm + 2 * CRATE_WALL_MM,
    widthMm: across * item.boxWidthMm + 2 * CRATE_WALL_MM,
    heightMm: rows * item.boxHeightMm + 2 * CRATE_WALL_MM,
  };
}

// Each HP variant fills its own pallets up to the weight limit. What's left of each
// variant is then clubbed in bottom-layer order, each remainder staying whole on the
// first pallet it fits. Remainders that don't fit start another pallet.
function buildMotorDrafts(items: OrderItem[], cfg: PresetConfig): PalletDraft[] {
  const drafts: PalletDraft[] = [];
  const widthMm = resolvePalletWidth(items[0], cfg);
  const remainders: PalletSku[] = [];

  for (const item of [...items].sort((a, b) => b.quantity - a.quantity)) {
    // A single motor over the weight limit still gets a pallet of its own
    const perPalletByWeight = Math.max(1, Math.floor(
      (cfg.maxPalletGrossKg - resolveWoodWeight(item, false)) / item.grossWeightKg
    ));
    // Motor columns run along the pallet: only as many as the length cap allows
    // (at least one, so a motor longer than the cap still gets a pallet)
    const perPallet = Math.min(perPalletByWeight, maxMotorsWithinLength(item, cfg), cfg.motorQtyPerPallet);
    for (let i = 0; i < Math.floor(item.quantity / perPallet); i++) {
      drafts.push({ skus: [{ item, qty: perPallet }], widthMm, motorOnly: true });
    }
    const qty = item.quantity % perPallet;
    if (qty > 0) remainders.push({ item, qty });
  }

  const clubbed: PalletSku[][] = [];
  // Per Mahendra: longest box always at bottom; weight is tiebreaker only.
  for (const remainder of remainders.sort((a, b) => bottomLayerFirst(a.item, b.item))) {
    const pallet = clubbed.find(skus =>
      palletGrossKg([...skus, remainder]) <= cfg.maxPalletGrossKg &&
      motorPalletLengthMm([...skus, remainder], cfg) <= cfg.maxPalletLengthMm &&
      boxCount(skus) + remainder.qty <= cfg.motorQtyPerPallet
    );
    if (pallet) pallet.push(remainder);
    else clubbed.push([remainder]);
  }
  clubbed.forEach(skus => drafts.push({ skus, widthMm, motorOnly: true }));
  return drafts;
}

// Most motors of this item one pallet holds within the preset's length cap:
// whole columns along the pallet, each MOTORS_PER_ROW across and full height.
// Infinity when the preset has no length cap.
function maxMotorsWithinLength(item: OrderItem, cfg: PresetConfig): number {
  if (!Number.isFinite(cfg.maxPalletLengthMm)) return Infinity;
  const { layers } = computeMotorPalletGeometry(item, Number.MAX_SAFE_INTEGER, cfg);
  const columns = Math.max(1, Math.floor(cfg.maxPalletLengthMm / item.boxLengthMm));
  return columns * cfg.motorsPerRow * layers;
}

// Length of a motor-only pallet holding these motors (as finalizePallet builds it)
function motorPalletLengthMm(skus: PalletSku[], cfg: PresetConfig): number {
  const longest = skus.reduce((a, b) => (b.item.boxLengthMm > a.item.boxLengthMm ? b : a)).item;
  return computeMotorPalletGeometry(longest, boxCount(skus), cfg).lengthMm;
}

function sameCustomer(a: PalletDraft, b: PalletDraft): boolean {
  return (a.skus[0].item.customer ?? '') === (b.skus[0].item.customer ?? '');
}

function isPumpDraft(d: PalletDraft): boolean {
  return d.skus.every(s => s.item.productType === 'pump');
}

// Whether another pallet's boxes fit as new layers on top of this one
function canAbsorb(host: PalletDraft, guestSkus: PalletSku[], widthMm: number, cfg: PresetConfig): boolean {
  return fitsOnePallet([...host.skus, ...guestSkus], widthMm, cfg);
}

// A pump pallet goes on top of another pump pallet, including one from another
// pool, when it fits. The merged pallet takes the wider of the two widths.
function mergeSmallPumpPallets(drafts: PalletDraft[], cfg: PresetConfig): PalletDraft[] {
  let result = drafts;
  const longestFirst = [...drafts].sort((a, b) => longestBoxMm(b.skus) - longestBoxMm(a.skus));
  for (const guest of longestFirst) {
    if (!isPumpDraft(guest)) continue;
    const host = result
      .filter(d =>
        d !== guest &&
        isPumpDraft(d) &&
        sameCustomer(d, guest) &&
        poolsWithinGap(d.skus, guest.skus, cfg) &&
        canAbsorb(d, guest.skus, Math.max(d.widthMm, guest.widthMm), cfg)
      )
      .sort((a, b) => palletGrossKg(b.skus) - palletGrossKg(a.skus))[0];
    if (!host) continue;
    host.skus = [...host.skus, ...guest.skus];
    host.widthMm = Math.max(host.widthMm, guest.widthMm);
    result = result.filter(d => d !== guest);
  }
  return result;
}

// The face size of a small pump pallet that may be clubbed, or null if it may not:
// up to CLUB_MAX_BOXES boxes, all of one clubbing face size
function clubFaceMm(d: PalletDraft): number | null {
  if (!isPumpDraft(d) || boxCount(d.skus) > CLUB_MAX_BOXES) return null;
  const { boxWidthMm, boxHeightMm } = d.skus[0].item;
  const oneFace = boxWidthMm === boxHeightMm &&
    d.skus.every(s => s.item.boxWidthMm === boxWidthMm && s.item.boxHeightMm === boxHeightMm);
  return oneFace && CLUB_FACE_SIZES_MM.includes(boxWidthMm) ? boxWidthMm : null;
}

// Per Mahendra: longest box always at bottom; weight is tiebreaker only.
function clubbedDraft(a: PalletDraft, b: PalletDraft): PalletDraft {
  const skus = [...a.skus, ...b.skus].sort((x, y) => bottomLayerFirst(x.item, y.item));
  return { skus, widthMm: Math.max(a.widthMm, b.widthMm), motorOnly: false };
}

// Mahendra's rule: after primary grouping, a small 100mm-face pallet and a small
// 152mm-face pallet of one customer become one pallet if the result is within the
// weight and height limits. Only those limits apply: these pools would not merge
// under the layering rules in fitsOnePallet. Heaviest pallets are paired first, each
// with the heaviest partner that fits; a clubbed pallet isn't clubbed again.
// When the preset allows mixed families, any two small pump pallets of one
// customer may be clubbed, whatever their face sizes.
function clubLeftovers(drafts: PalletDraft[], cfg: PresetConfig): PalletDraft[] {
  const result = [...drafts];
  const clubbable = (d: PalletDraft) => cfg.allowCrossFamily
    ? isPumpDraft(d) && boxCount(d.skus) <= CLUB_MAX_BOXES
    : clubFaceMm(d) !== null;
  const candidates = drafts
    .filter(clubbable)
    .sort((a, b) => palletGrossKg(b.skus) - palletGrossKg(a.skus));
  const used = new Set<PalletDraft>();

  for (const a of candidates) {
    if (used.has(a)) continue;
    for (const b of candidates) {
      if (used.has(b) || a === b || !sameCustomer(a, b)) continue;
      if (!cfg.allowCrossFamily && clubFaceMm(a) === clubFaceMm(b)) continue;
      const clubbed = clubbedDraft(a, b);
      if (
        palletGrossKg(clubbed.skus) > cfg.maxPalletGrossKg ||
        longestBoxMm(clubbed.skus) > cfg.maxPalletLengthMm ||
        layeredHeightMm(clubbed.skus, clubbed.widthMm) > cfg.maxPumpTotalHeightMm
      ) continue;
      used.add(a);
      used.add(b);
      result[result.indexOf(a)] = clubbed;
      result.splice(result.indexOf(b), 1);
      break;
    }
  }
  return result;
}

// Motor pallets go on top of a pump pallet when they fit. Returns the motor
// pallets that still stand on their own.
function mergeSmallMotorPallets(motors: PalletDraft[], pumps: PalletDraft[], cfg: PresetConfig): PalletDraft[] {
  return motors.filter(guest => {
    // Per Mahendra: longest box always at bottom; weight is tiebreaker only.
    const longestFirst = [...guest.skus].sort((a, b) => bottomLayerFirst(a.item, b.item));
    const host = pumps
      .filter(d =>
        d.skus[0].item.productType === 'pump' &&
        sameCustomer(d, guest) &&
        guest.skus.every(s => s.item.boxWidthMm <= d.widthMm) &&
        canAbsorb(d, longestFirst, d.widthMm, cfg)
      )
      .sort((a, b) => palletGrossKg(b.skus) - palletGrossKg(a.skus))[0];
    if (!host) return true;
    host.skus = [...host.skus, ...longestFirst];
    return false;
  });
}


function finalizePallet(draft: PalletDraft, palletId: string, cfg: PresetConfig): PalletPlan {
  const { skus, motorOnly } = draft;
  let { widthMm } = draft;
  const totalQty = boxCount(skus);
  const bottom = skus[0].item;
  let lengthMm: number;
  let heightMm: number;
  let layers: PalletLayer[] | undefined;
  if (draft.crate) {
    ({ lengthMm, widthMm, heightMm } = crateGeometry(skus[0].item, totalQty));
  } else if (motorOnly) {
    // Mixed pallets are as long as their longest motor box
    const longest = skus.reduce((a, b) => (b.item.boxLengthMm > a.item.boxLengthMm ? b : a)).item;
    ({ lengthMm, heightMm } = computeMotorPalletGeometry(longest, totalQty, cfg));
  } else {
    layers = buildLayers(skus, widthMm, draft.sharedRows);
    lengthMm = longestBoxMm(skus);
    heightMm = layeredHeightMm(skus, widthMm, draft.sharedRows);
  }
  const grossKg = boxesGrossKg(skus);
  const woodWeightKg = draft.crate ? WOOD_WEIGHT.CRATE : woodKg(skus);
  const totalNetKg = skus.reduce((sum, { item, qty }) => sum + item.netWeightKg * qty, 0);
  const cbm = (lengthMm * widthMm * heightMm) / 1_000_000_000;

  return {
    palletId,
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
    ...(draft.crate && { kind: 'crate' as const }),
  };
}

export function buildPalletPlans(items: OrderItem[], cfg: PresetConfig = STANDARD): PalletPlan[] {
  const groups = new Map<string, OrderItem[]>();

  // A product code entered on several lines is one line with the summed
  // quantity (other fields from its first line); kept apart per customer
  const merged = new Map<string, OrderItem>();
  for (const item of items) {
    // A short code and its full form are the same product
    const productCode = normaliseProductCode(item.productCode);
    const key = `${item.customer ?? 'default'}::${productCode}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += item.quantity;
    else merged.set(key, { ...item, productCode });
  }

  for (const item of Array.from(merged.values())) {
    const key = consolidationKey(item, cfg);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  // Heaviest group first, so the biggest pumps are placed before smaller ones
  const sortedGroups = Array.from(groups.values()).sort((a, b) => groupGrossKg(b) - groupGrossKg(a));

  // All pump pallets first, then motors, which may finish on top of a pump pallet
  // Freepack fills pump pallets factory-style; the other presets build layered pallets
  const pumpDrafts = (g: OrderItem[]) => cfg.allowCrossFamily ? buildFilledPumpDrafts(g, cfg) : buildPumpDrafts(g, cfg);
  const pumps = clubLeftovers(mergeSmallPumpPallets(
    sortedGroups.filter(g => !isMotor(g[0])).flatMap(pumpDrafts),
    cfg,
  ), cfg);
  // V4 motors go in crates when the preset says so; they never top a pump pallet
  const crated = (i: OrderItem) => cfg.v4MotorsInCrates && i.productType === 'motor-V4';
  const motorGroups = sortedGroups.filter(g => isMotor(g[0]));
  const crates = buildCrateDrafts(motorGroups.flatMap(g => g.filter(crated)));
  const motors = mergeSmallMotorPallets(
    motorGroups
      .map(g => g.filter(i => !crated(i)))
      .filter(g => g.length > 0)
      .flatMap(g => buildMotorDrafts(g, cfg)),
    pumps,
    cfg,
  );

  // Pallets numbered SK-01…, crates CR-01…
  let palletNo = 0;
  let crateNo = 0;
  const id = (d: PalletDraft) => d.crate
    ? `CR-${String(++crateNo).padStart(2, '0')}`
    : `SK-${String(++palletNo).padStart(2, '0')}`;
  return [...pumps, ...motors, ...crates].map(draft => finalizePallet(draft, id(draft), cfg));
}

// ─── Stacking ────────────────────────────────────────────────────────────────
// A pallet may go on top of another only if all of these hold
// The rules live in stacking.ts, shared with the floor plan editor
function canStack(bottom: PalletPlan, top: PalletPlan): boolean {
  return stackingProblem(bottom, top) === null;
}

// Pairs pallets two-high. Heaviest pallets are tried as bottoms first; each
// takes the best top that passes canStack: same family first, then the one
// saving the most floor. A pallet is in at most one stack (no triple stacking).
// Stops after maxPairs pairs.
export function stackPallets(pallets: PalletPlan[], maxPairs = Infinity): PalletPlan[] {
  // Whole-pallet stacking: heavier on floor (forklift stability).
  // Longest-at-bottom applies only to box layers within a pallet.
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

// Floor packing: rows in length order (packPallets), or with turning (Freepack)
type FloorPacker = (pallets: PalletPlan[], containerLength: number) => PlacedPallet[];

function fitsFloor(pallets: PalletPlan[], containerLength: number, pack: FloorPacker): boolean {
  return pack(pallets, containerLength).every(p => !p.overflow);
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
  pack: FloorPacker,
): PalletPlan[] | null {
  if (built.some(p => p.lengthMm > option.inner.lengthMm)) return null;
  if (totalCBM > option.limits.maxCBM || totalGrossKg > option.limits.maxPayloadKg) return null;
  if (fitsFloor(built, option.inner.lengthMm, pack)) return built;
  const possiblePairs = stackedPairCount(stackPallets(built));
  for (let pairs = 1; pairs <= possiblePairs; pairs++) {
    const stacked = stackPallets(built, pairs);
    if (fitsFloor(stacked, option.inner.lengthMm, pack)) return stacked;
  }
  return null;
}

// Fills 40ft containers one at a time, each within its floor, CBM and payload
// limits. Every pallet passed in must fit a 40ft on its own.
function loadInto40ftContainers(pallets: PalletPlan[], pack: FloorPacker): PlacedPallet[][] {
  const { inner, limits } = FCL_OPTIONS[1];
  const loads: PlacedPallet[][] = [];
  let remaining = pallets;
  while (remaining.length > 0) {
    const load: PlacedPallet[] = [];
    let cbm = 0;
    let grossKg = 0;
    for (const placed of pack(remaining, inner.lengthMm)) {
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

// presetConfig sets the pallet width, height and weight limits; it defaults to the
// Standard rules. preset is recorded on the result so a saved plan reloads with it.
// Container payload caps (CONTAINERS) are the same under every preset.
export function computeShipment(
  items: OrderItem[],
  presetConfig: PresetConfig = PRESET_CONFIGS[DEFAULT_PRESET],
  preset: RulePreset = DEFAULT_PRESET,
): ShipmentResult {
  const cfg = presetConfig;
  const pack: FloorPacker = cfg.rotatePalletsOnFloor ? packPalletsTurning : packPallets;
  // Pallets start unstacked; stacking is used only if the floor needs it
  const built = buildPalletPlans(items, cfg);
  let pallets = built;
  const warnings: string[] = [];
  const totalCBM = pallets.reduce((sum, p) => sum + p.cbm, 0);
  const totalGrossKg = pallets.reduce((sum, p) => sum + p.totalGrossKg, 0);

  pallets.forEach((p) => {
    if (p.kind === 'crate') {
      // A crate stands on the container floor with no pallet base: its limit is
      // the container's interior height, not a pallet height cap
      if (p.heightMm > CONTAINER_INNER_20FT.heightMm) {
        warnings.push(
          `${p.palletId}: Crate height ${p.heightMm.toLocaleString('en-US')}mm exceeds container interior height limit of ` +
          `${CONTAINER_INNER_20FT.heightMm.toLocaleString('en-US')}mm`,
        );
      }
    } else {
      // Motor-only pallets have a motor family (SM-…) at the bottom
      const maxHeightMm = p.family.startsWith('SM-') ? cfg.maxMotorTotalHeightMm : cfg.maxPumpTotalHeightMm;
      if (p.heightMm > maxHeightMm) {
        warnings.push(`${p.palletId}: height ${p.heightMm}mm exceeds max pallet height ${maxHeightMm}mm`);
      }
    }
    if (p.lengthMm > CONTAINER_INNER_40FT.lengthMm) {
      warnings.push(`${p.palletId}: length ${p.lengthMm}mm exceeds 40ft inner length — no container fits it, arrange this pallet separately`);
    } else if (p.lengthMm > CONTAINER_INNER_20FT.lengthMm) {
      warnings.push(`${p.palletId}: length ${p.lengthMm}mm exceeds 20ft internal length — requires 40ft container`);
    }
    if (p.lengthMm > MAX_PUMP_PALLET_LENGTH_MM) {
      warnings.push(`${p.palletId}: length ${p.lengthMm}mm exceeds practical pallet limit (${MAX_PUMP_PALLET_LENGTH_MM}mm) — verify floor-plan with Mahendra`);
    }
    if (p.lengthMm > cfg.maxPalletLengthMm) {
      warnings.push(`${p.palletId}: length ${p.lengthMm}mm exceeds the ${cfg.maxPalletLengthMm}mm pallet length cap — a single box is longer than the cap`);
    }
    if (p.totalGrossKg > cfg.maxPalletGrossKg) {
      warnings.push(`${p.palletId}: gross weight ${p.totalGrossKg}kg — verify forklift capacity`);
    }
  });

  // Container decision order: 20ft flat → 20ft stacked → 40ft flat → 40ft stacked
  // → multiple containers. The first size whose floor, CBM and payload all hold wins.
  let chosen: FclOption | null = null;
  let chosenPallets: PalletPlan[] | null = null;
  for (const option of FCL_OPTIONS) {
    chosenPallets = fitContainer(built, option, totalCBM, totalGrossKg, pack);
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
    placed = pack(pallets, chosen.inner.lengthMm);
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
    const lowestCount = loadInto40ftContainers(stackPallets(loadable), pack).length;
    let stacked = loadable;
    let loads = loadInto40ftContainers(stacked, pack);
    for (let pairs = 1; loads.length > lowestCount; pairs++) {
      stacked = stackPallets(loadable, pairs);
      loads = loadInto40ftContainers(stacked, pack);
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
    preset,
  };
}
