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
} from '@/lib/constants';

// ─── STEP 1: Resolve pallet width for an item ────────────────────────────────
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

// ─── STEP 2: Resolve wood weight for a pallet ────────────────────────────────
export function resolveWoodWeight(item: OrderItem, isMixedSku: boolean): number {
  if (item.productType === 'motor-V4' || item.productType === 'motor-V6') {
    return isMixedSku ? WOOD_WEIGHT.MOTOR_MIXED_SKU : WOOD_WEIGHT.MOTOR_SINGLE_SKU;
  }
  const heavyFamilies = ['SK77', 'SK95', 'SK95A', 'SK95B'];
  return heavyFamilies.includes(item.palletFamily)
    ? WOOD_WEIGHT.PUMP_HEAVY
    : WOOD_WEIGHT.PUMP_LIGHT;
}

// ─── STEP 3: Compute pallet geometry from box stacking ───────────────────────
export function computePalletGeometry(
  item: OrderItem,
  palletWidthMm: number
): { lengthMm: number; heightMm: number; unitsPerRow: number; rows: number; layers: number } {
  // How many boxes fit side-by-side across the pallet width?
  const unitsPerRow = Math.floor(palletWidthMm / item.boxWidthMm);
  if (unitsPerRow === 0) {
    throw new Error(
      `Box width ${item.boxWidthMm}mm exceeds pallet width ${palletWidthMm}mm for ${item.productCode}`
    );
  }

  // Stack layers vertically (motors up to 2 layers, pumps 1)
  const isMotor = item.productType === 'motor-V4' || item.productType === 'motor-V6';
  let layers = isMotor ? 2 : 1;
  let heightMm = layers * item.boxHeightMm + PALLET_BASE_HEIGHT_MM;

  // Drop layers until the pallet (including its wooden base) fits under the stack limit
  while (heightMm > MAX_STACK_HEIGHT_MM && layers > 1) {
    layers--;
    heightMm = layers * item.boxHeightMm + PALLET_BASE_HEIGHT_MM;
  }

  // How many rows along the pallet length?
  const rows = Math.ceil(item.quantity / (unitsPerRow * layers));
  const lengthMm = rows * item.boxLengthMm;

  return { lengthMm, heightMm, unitsPerRow, rows, layers };
}

// ─── STEP 4: Build pallet plans from a list of order items ───────────────────
export function buildPalletPlans(items: OrderItem[]): PalletPlan[] {
  const pallets: PalletPlan[] = [];
  const MAX_PALLET_LENGTH_MM = CONTAINER_LENGTH_MM.FCL_40FT;

  items.forEach((item, itemIndex) => {
    const palletNumber = String(itemIndex + 1).padStart(2, '0');
    const palletWidthMm = resolvePalletWidth(item);
    const { heightMm, unitsPerRow, layers } = computePalletGeometry(item, palletWidthMm);
    const unitsPerLayer = unitsPerRow * layers;

    // How many units can fit in one pallet given max length?
    const maxRowsPerPallet = Math.floor(MAX_PALLET_LENGTH_MM / item.boxLengthMm);
    const maxUnitsPerPallet = maxRowsPerPallet * unitsPerLayer;
    if (maxUnitsPerPallet === 0) {
      throw new Error(
        `${item.productCode}: pallet length ${item.boxLengthMm}mm exceeds maximum container length — check box dimensions or quantity`
      );
    }

    let remaining = item.quantity;
    let splitIndex = 1;

    while (remaining > 0) {
      const unitsThisPallet = Math.min(remaining, maxUnitsPerPallet);
      const rowsThisPallet = Math.ceil(unitsThisPallet / unitsPerLayer);
      const lengthMm = rowsThisPallet * item.boxLengthMm;

      if (lengthMm > CONTAINER_LENGTH_MM.FCL_40FT) {
        throw new Error(
          `${item.productCode}: pallet length ${lengthMm}mm exceeds maximum container length — check box dimensions or quantity`
        );
      }

      const cbm = (lengthMm * palletWidthMm * heightMm) / 1_000_000_000;
      const netWeightKg = (item.netWeightKg / item.quantity) * unitsThisPallet;
      const grossWeightKg = (item.grossWeightKg / item.quantity) * unitsThisPallet;
      const isMixedSku = false; // single-item call; mixed handled separately
      const woodWeightKg = resolveWoodWeight(item, isMixedSku);
      const totalGrossKg = grossWeightKg + woodWeightKg;

      pallets.push({
        palletId: `SK-${palletNumber}${splitIndex > 1 ? `-P${splitIndex}` : ''}`,
        family: item.palletFamily,
        productCode: item.productCode,
        quantity: unitsThisPallet,
        lengthMm,
        widthMm: palletWidthMm,
        heightMm,
        cbm: Math.round(cbm * 1000) / 1000,
        netWeightKg: Math.round(netWeightKg * 10) / 10,
        grossWeightKg: Math.round(grossWeightKg * 10) / 10,
        woodWeightKg,
        totalGrossKg: Math.round(totalGrossKg * 10) / 10,
        isMixedSku,
      });

      remaining -= unitsThisPallet;
      splitIndex++;
    }
  });

  return pallets;
}

// ─── STEP 5: Aggregate + recommend container ─────────────────────────────────
export function computeShipment(items: OrderItem[]): ShipmentResult {
  const pallets = buildPalletPlans(items);
  const warnings: string[] = [];

  const totalCBM = pallets.reduce((sum, p) => sum + p.cbm, 0);
  const totalGrossKg = pallets.reduce((sum, p) => sum + p.totalGrossKg, 0);

  // Any pallet longer than a 20ft container's internal length rules out 20ft
  const requires40ft = pallets.some((p) => p.lengthMm > CONTAINER_LENGTH_MM.FCL_20FT);

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
    if (p.lengthMm > 9000) {
      warnings.push(`${p.palletId}: length ${p.lengthMm}mm — verify with Mahendra before loading`);
    }
  });

  // Container recommendation
  let containerRecommendation: ShipmentResult['containerRecommendation'];
  if (
    totalCBM <= CONTAINERS.FCL_20FT.maxCBM &&
    totalGrossKg <= CONTAINERS.FCL_20FT.maxPayloadKg &&
    !requires40ft
  ) {
    containerRecommendation = 'FCL_20FT';
  } else if (
    totalCBM <= CONTAINERS.FCL_40FT.maxCBM &&
    totalGrossKg <= CONTAINERS.FCL_40FT.maxPayloadKg
  ) {
    containerRecommendation = 'FCL_40FT';
  } else {
    containerRecommendation = 'MULTI_CONTAINER';
    warnings.push('Shipment exceeds 40ft FCL limits — coordinate with freight forwarder for split shipment');
  }

  // Guard: a pallet longer than 20ft can never ship in a 20ft
  if (requires40ft && containerRecommendation === 'FCL_20FT') {
    containerRecommendation = 'FCL_40FT';
    warnings.push('One or more pallets exceed 5,898mm — 20ft container not possible');
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

  return {
    pallets,
    totalCBM: Math.round(totalCBM * 1000) / 1000,
    totalGrossKg: Math.round(totalGrossKg * 10) / 10,
    containerRecommendation,
    warnings,
  };
}
