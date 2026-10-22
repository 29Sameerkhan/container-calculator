import {
  CustomerSummary,
  OrderItem,
  PalletPlan,
  ShipmentOrder,
  ShipmentResult,
} from '@/lib/types';
import {
  CONTAINERS,
  CONTAINER_LENGTH_MM,
  FCL_20FT_BAND_MAX_CBM,
  WOOD_WEIGHT,
  MAX_STACK_HEIGHT_MM,
  STANDARD_PALLETS,
  MAX_PALLET_HEIGHT_MM,
  PALLET_BASE_HEIGHT_MM,
  MAX_PALLET_GROSS_KG,
  MAX_STACKED_HEIGHT_MM,
} from '@/lib/constants';
import { packPallets } from '@/lib/engine/floorPlan';

// ─── STEP 1: Resolve wood weight for a pallet ────────────────────────────────
export function resolveWoodWeight(item: OrderItem, isMixedSku: boolean): number {
  if (item.productType === 'motor-V4' || item.productType === 'motor-V6') {
    return isMixedSku ? WOOD_WEIGHT.MOTOR_MIXED_SKU : WOOD_WEIGHT.MOTOR_SINGLE_SKU;
  }
  const heavyFamilies = ['SK77', 'SK95', 'SK95A', 'SK95B'];
  return heavyFamilies.includes(item.palletFamily)
    ? WOOD_WEIGHT.PUMP_HEAVY
    : WOOD_WEIGHT.PUMP_LIGHT;
}

// ─── STEP 2: Arrange boxes on a pallet base ──────────────────────────────────
// How one product line's boxes sit on a full pallet
export interface PalletLayout {
  baseName: string;      // Large / Medium / Small, or Long for an over-length box
  isLongPallet: boolean; // box longer than any standard base
  baseLengthMm: number;  // pallet_L
  baseWidthMm: number;   // pallet_W
  boxAlongMm: number;    // box side running along the pallet length
  boxAcrossMm: number;   // box side running across the pallet width
  boxesPerRow: number;   // along the length
  boxesPerCol: number;   // across the width
  boxesPerLayer: number;
  maxLayers: number;
  boxesPerPallet: number;
}

// Standard bases are tried Large → Medium → Small; on each the box is tried as
// entered, then turned 90° on the pallet. A box longer than the Large base gets
// a long pallet as long as the box. Returns null when the box fits no pallet.
export function computePalletLayout(item: OrderItem): PalletLayout | null {
  const maxLayers = Math.floor((MAX_PALLET_HEIGHT_MM - PALLET_BASE_HEIGHT_MM) / item.boxHeightMm);
  if (maxLayers === 0) return null; // a single box is taller than the pallet limit

  const layout = (
    baseName: string, baseLengthMm: number, baseWidthMm: number, boxAlongMm: number, boxAcrossMm: number
  ): PalletLayout => {
    const boxesPerRow = Math.floor(baseLengthMm / boxAlongMm);
    const boxesPerCol = Math.floor(baseWidthMm / boxAcrossMm);
    const boxesPerLayer = boxesPerRow * boxesPerCol;
    return {
      baseName, isLongPallet: baseName === 'Long', baseLengthMm, baseWidthMm, boxAlongMm, boxAcrossMm,
      boxesPerRow, boxesPerCol, boxesPerLayer, maxLayers, boxesPerPallet: boxesPerLayer * maxLayers,
    };
  };

  const { boxLengthMm: L, boxWidthMm: W } = item;
  for (const base of STANDARD_PALLETS) {
    for (const [along, across] of [[L, W], [W, L]]) {
      const fit = layout(base.name, base.lengthMm, base.widthMm, along, across);
      if (fit.boxesPerPallet > 0) return fit;
    }
  }

  // Long pallet: as long as the box, one box per row, still filled across and up
  const large = STANDARD_PALLETS[0];
  if (L > large.lengthMm && L <= CONTAINER_LENGTH_MM.FCL_40FT) {
    const fit = layout('Long', L, large.widthMm, L, W);
    if (fit.boxesPerPallet > 0) return fit;
  }
  return null;
}

// ─── STEP 3: Build pallet plans from all orders' items ───────────────────────
// Each line's boxes are spread over as many pallets as needed. A pallet is also
// capped by weight so it never exceeds the forklift limit (MAX_PALLET_GROSS_KG).
// Lines whose box fits no pallet are left out and reported in warnings.
export function buildPalletPlans(orders: ShipmentOrder[]): { pallets: PalletPlan[]; warnings: string[] } {
  const pallets: PalletPlan[] = [];
  const warnings: string[] = [];

  // Flatten items across orders, keeping each item's owner; numbering runs
  // across the whole shipment so pallet IDs stay unique
  const lines = orders.flatMap(order =>
    order.items.map(item => ({ item, customerName: order.customerName, orderRef: order.orderRef }))
  );

  lines.forEach(({ item, customerName, orderRef }, itemIndex) => {
    const palletNumber = String(itemIndex + 1).padStart(2, '0');
    const layout = computePalletLayout(item);
    if (!layout) {
      const box = `${item.boxLengthMm}×${item.boxWidthMm}×${item.boxHeightMm}mm`;
      warnings.push(
        `SK-${palletNumber} (${item.productCode}): OVERSIZED — box ${box} fits no pallet. ${item.quantity} box${item.quantity > 1 ? 'es' : ''} left out of this plan; arrange special handling with Mahendra`
      );
      return;
    }

    const isMixedSku = false; // single-item call; mixed handled separately
    const woodWeightKg = resolveWoodWeight(item, isMixedSku);
    const boxesByWeight = Math.floor((MAX_PALLET_GROSS_KG - woodWeightKg) / item.grossWeightKg);
    if (boxesByWeight < 1) {
      warnings.push(
        `SK-${palletNumber} (${item.productCode}): one box on its pallet weighs ${item.grossWeightKg + woodWeightKg}kg — over the ${MAX_PALLET_GROSS_KG}kg forklift limit`
      );
    }
    const boxesPerPallet = Math.max(1, Math.min(layout.boxesPerPallet, boxesByWeight));

    let remaining = item.quantity;
    let splitIndex = 1;

    while (remaining > 0) {
      const unitsThisPallet = Math.min(remaining, boxesPerPallet);
      // Fewest layers that hold these boxes, then rows for the fullest layer
      const layers = Math.ceil(unitsThisPallet / layout.boxesPerLayer);
      const rows = Math.ceil(Math.ceil(unitsThisPallet / layers) / layout.boxesPerCol);
      const lengthMm = Math.min(rows * layout.boxAlongMm, layout.baseLengthMm);
      const widthMm = Math.min(layout.boxesPerCol * layout.boxAcrossMm, layout.baseWidthMm);
      const heightMm = layers * item.boxHeightMm + PALLET_BASE_HEIGHT_MM;

      const cbm = (lengthMm * widthMm * heightMm) / 1_000_000_000;
      // Item weights are per box
      const netWeightKg = item.netWeightKg * unitsThisPallet;
      const grossWeightKg = item.grossWeightKg * unitsThisPallet;
      const totalGrossKg = grossWeightKg + woodWeightKg;
      const palletId = `SK-${palletNumber}${splitIndex > 1 ? `-P${splitIndex}` : ''}`;

      pallets.push({
        palletId,
        customerName,
        orderRef,
        family: item.palletFamily,
        productCode: item.productCode,
        productCodes: [item.productCode], // one SKU per pallet until mixed palletising exists
        quantity: unitsThisPallet,
        lengthMm,
        widthMm,
        heightMm,
        cbm: Math.round(cbm * 1000) / 1000,
        netWeightKg: Math.round(netWeightKg * 10) / 10,
        grossWeightKg: Math.round(grossWeightKg * 10) / 10,
        woodWeightKg,
        totalGrossKg: Math.round(totalGrossKg * 10) / 10,
        isMixedSku,
        ...(layout.isLongPallet && { isLongPallet: true }),
      });

      if (layout.isLongPallet) {
        warnings.push(
          `Pallet ${palletId} is ${item.boxLengthMm}mm long — needs flat-bed or special handling, verify with Mahendra`
        );
      }

      remaining -= unitsThisPallet;
      splitIndex++;
    }
  });

  return { pallets, warnings };
}

// ─── STEP 4b: Floor fit + conditional stacking ───────────────────────────────
// Floor fit uses the same row-fill packing as the floor plan drawing, so the
// recommendation and the drawing always agree. Stacked pairs take one footprint.
export function fitsFloor(pallets: PalletPlan[], containerLength: number): boolean {
  return packPallets(pallets, containerLength).every(p => !p.overflow);
}

// A pair may be stacked only if ALL rules hold
function canStack(bottom: PalletPlan, top: PalletPlan): boolean {
  return (
    top.widthMm === bottom.widthMm &&                                // same footprint width
    bottom.heightMm + top.heightMm <= MAX_STACKED_HEIGHT_MM &&       // headroom
    bottom.totalGrossKg + top.totalGrossKg <= MAX_PALLET_GROSS_KG && // forklift cap
    bottom.totalGrossKg >= top.totalGrossKg &&                       // heavier on bottom
    top.lengthMm <= bottom.lengthMm &&                               // no overhang
    top.customerName === bottom.customerName &&                      // keep consignees apart
    top.orderRef === bottom.orderRef
  );
}

// Stack pallets two-high ONLY as far as needed to fit a floor of targetLength.
// Greedy, fewest pairs: each round stacks the valid pair that removes the most
// floor length (the top pallet's footprint), then re-checks the fit and stops
// as soon as everything fits. Never more than 2 per stack.
// Returns every physical pallet (same order) with stack fields set on the
// pairs used. If no stacking can make it fit, the caller should discard it.
export function stackPallets(pallets: PalletPlan[], targetLength: number): PalletPlan[] {
  let current = pallets;

  while (!fitsFloor(current, targetLength)) {
    const free = current.filter(p => !p.isStacked);
    let best: { bottom: PalletPlan; top: PalletPlan } | null = null;

    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        for (const [bottom, top] of [[free[i], free[j]], [free[j], free[i]]]) {
          if (!canStack(bottom, top)) continue;
          if (!best || top.lengthMm > best.top.lengthMm) best = { bottom, top };
        }
      }
    }
    if (!best) break; // no valid pair left

    const { bottom, top } = best;
    current = current.map(p =>
      p === bottom ? { ...p, isStacked: true, stackedWith: top.palletId, stackPosition: 'bottom' as const }
      : p === top ? { ...p, isStacked: true, stackedWith: bottom.palletId, stackPosition: 'top' as const }
      : p
    );
  }

  return current;
}

// ─── Per-order totals, in the order the orders were given ────────────────────
// Orders are matched by customerName + orderRef, so two orders from the same
// customer get separate rows; orders with identical name and ref are merged.
function summariseByOrder(orders: ShipmentOrder[], pallets: PalletPlan[]): CustomerSummary[] {
  const key = (customerName: string, orderRef: string) => `${customerName}\u0000${orderRef}`;
  const summaries = new Map<string, CustomerSummary>();

  for (const { customerName, orderRef } of orders) {
    if (!summaries.has(key(customerName, orderRef))) {
      summaries.set(key(customerName, orderRef), { customerName, orderRef, totalCBM: 0, totalGrossKg: 0, palletCount: 0 });
    }
  }
  for (const p of pallets) {
    const s = summaries.get(key(p.customerName, p.orderRef))!;
    s.totalCBM += p.cbm;
    s.totalGrossKg += p.totalGrossKg;
    s.palletCount += 1;
  }

  return Array.from(summaries.values()).map(s => ({
    ...s,
    totalCBM: Math.round(s.totalCBM * 1000) / 1000,
    totalGrossKg: Math.round(s.totalGrossKg * 10) / 10,
  }));
}

// ─── STEP 5: Aggregate + recommend container ─────────────────────────────────
export function computeShipment(orders: ShipmentOrder[]): ShipmentResult {
  // Pallets start unstacked; stacking is applied below only if it is the
  // difference between fitting a container floor or not
  const { pallets: built, warnings } = buildPalletPlans(orders);
  let pallets = built;

  // Stacking never changes these totals
  const totalCBM = built.reduce((sum, p) => sum + p.cbm, 0);
  const totalGrossKg = built.reduce((sum, p) => sum + p.totalGrossKg, 0);

  // Validate each pallet
  pallets.forEach((p) => {
    if (p.heightMm > MAX_STACK_HEIGHT_MM) {
      warnings.push(`${p.palletId}: height ${p.heightMm}mm exceeds max stack height ${MAX_STACK_HEIGHT_MM}mm`);
    }
    if (p.lengthMm > CONTAINER_LENGTH_MM.FCL_20FT) {
      warnings.push(
        `${p.palletId}: length ${p.lengthMm}mm exceeds 20ft internal length ${CONTAINER_LENGTH_MM.FCL_20FT}mm — 20ft container not possible`
      );
    }
  });

  // Container recommendation.
  // Each FCL size must pass its CBM/payload band AND fit its floor. Floor fit is
  // tried unstacked first; stacking is only attempted when that fails.
  let containerRecommendation: ShipmentResult['containerRecommendation'];
  let containersNeeded: number | undefined;

  const len20 = CONTAINER_LENGTH_MM.FCL_20FT;
  const len40 = CONTAINER_LENGTH_MM.FCL_40FT;
  const in20ftBand = totalCBM <= FCL_20FT_BAND_MAX_CBM && totalGrossKg <= CONTAINERS.FCL_20FT.maxPayloadKg;
  const in40ftBand = totalCBM <= CONTAINERS.FCL_40FT.maxCBM && totalGrossKg <= CONTAINERS.FCL_40FT.maxPayloadKg;

  // Returns stacked pallets if stacking rescues the fit, otherwise null
  const rescueByStacking = (length: number): PalletPlan[] | null => {
    const stacked = stackPallets(built, length);
    return fitsFloor(stacked, length) ? stacked : null;
  };
  const stackedNote = (stacked: PalletPlan[], size: string) => {
    const pairs = stacked.filter(p => p.stackPosition === 'bottom').length;
    warnings.push(
      `${pairs} stacked pair${pairs > 1 ? 's' : ''} needed to fit a ${size} — pallets stacked two-high, confirm with Mahendra before loading`
    );
  };

  // SLEKA books one full container per customer, so LCL only for a single
  // small pallet; 2+ pallets always get FCL regardless of volume
  if (built.length <= 1 && totalCBM < 2.0) {
    containerRecommendation = 'LCL';
    warnings.push('LCL recommended — volume too small for a full container. Consolidation charges will apply.');
  } else if (in20ftBand && fitsFloor(built, len20)) {
    containerRecommendation = 'FCL_20FT';
  } else if (in20ftBand && rescueByStacking(len20)) {
    pallets = rescueByStacking(len20)!;
    containerRecommendation = 'FCL_20FT';
    stackedNote(pallets, '20ft');
  } else if (in40ftBand && fitsFloor(built, len40)) {
    containerRecommendation = 'FCL_40FT';
  } else if (in40ftBand && rescueByStacking(len40)) {
    pallets = rescueByStacking(len40)!;
    containerRecommendation = 'FCL_40FT';
    stackedNote(pallets, '40ft');
  } else {
    containerRecommendation = 'MULTI_CONTAINER';
    const containersByVolume = Math.ceil(totalCBM / CONTAINERS.FCL_40FT.maxCBM);
    const containersByWeight = Math.ceil(totalGrossKg / CONTAINERS.FCL_40FT.maxPayloadKg);
    // Within the 40ft band but the pallets don't fit one 40ft floor even
    // stacked: floor space is the limit, so at least 2 containers
    const floorLimited = in40ftBand;
    containersNeeded = Math.max(containersByVolume, containersByWeight, floorLimited ? 2 : 1);
    const limitingFactor = floorLimited ? 'floor space' : containersByVolume >= containersByWeight ? 'volume' : 'weight';
    warnings.push(
      `Requires approximately ${containersNeeded} × 40ft FCL containers — limited by ${limitingFactor}. Coordinate with freight forwarder for split shipment.`
    );
  }

  // Weight warnings
  if (containerRecommendation === 'FCL_20FT') {
    const utilisation = totalGrossKg / CONTAINERS.FCL_20FT.maxPayloadKg;
    if (utilisation > 0.9)
      warnings.push(`20ft payload at ${(utilisation * 100).toFixed(0)}% — approaching limit`);
  }
  if (containerRecommendation === 'FCL_40FT') {
    const utilisation = totalGrossKg / CONTAINERS.FCL_40FT.maxPayloadKg;
    if (utilisation > 0.9)
      warnings.push(`40ft payload at ${(utilisation * 100).toFixed(0)}% — approaching limit`);
  }

  // Pallet positions on the recommended container's floor, saved with the
  // result so a reloaded calculation draws exactly this plan
  const placed = containerRecommendation === 'LCL'
    ? []
    : packPallets(pallets, containerRecommendation === 'FCL_20FT' ? len20 : len40);

  return {
    pallets,
    placed,
    perCustomer: summariseByOrder(orders, pallets),
    totalCBM: Math.round(totalCBM * 1000) / 1000,
    totalGrossKg: Math.round(totalGrossKg * 10) / 10,
    containerRecommendation,
    ...(containersNeeded !== undefined && { containersNeeded }),
    warnings,
  };
}
