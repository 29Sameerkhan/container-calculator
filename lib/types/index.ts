export interface OrderItem {
  productCode: string;
  productType: 'pump' | 'motor-V4' | 'motor-V6' | 'motor-V8' | 'controller' | 'spare';
  palletFamily: string;
  quantity: number;
  boxLengthMm: number;
  boxWidthMm: number;
  boxHeightMm: number;
  netWeightKg: number;
  grossWeightKg: number;
  stages?: number;
  customer?: string;
  weightManualEntry?: boolean;
}

export interface ShipmentOrder {
  customerName: string;
  orderRef: string;
  items: OrderItem[];
}

// One product on a layered pallet. Boxes lie along the pallet length in rows,
// so a layer is as high as its rows.
export interface PalletLayer {
  productCode: string;
  quantity: number;
  boxesAcross: number;
  rows: number;            // rows this layer adds; boxes in a shared row are in sharedRowQty
  sharedRowQty?: number;   // motors placed in the part-filled row of the layer below
  boxHeightMm?: number;    // one row's height; absent on older saved results
  lengthMm: number;
  heightMm: number;
  grossWeightKg: number;
}

export interface PalletPlan {
  palletId: string;
  customerName?: string;   // optional — not always set by engine
  orderRef?: string;       // optional — not always set by engine
  family: string;
  productCode: string;
  productCodes: string[];
  quantity: number;
  skuBreakdown?: Array<{ productCode: string; quantity: number; netWeightKg: number; grossWeightKg: number }>;
  layers?: PalletLayer[];  // bottom first; absent on motor-only pallets and older saved results
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  cbm: number;
  netWeightKg: number;
  grossWeightKg: number;
  woodWeightKg: number;
  totalGrossKg: number;
  isMixedSku: boolean;
  customer?: string;
  isStacked?: boolean;
  stackedWith?: string;
  stackPosition?: 'bottom' | 'top';
  isLongPallet?: boolean;
  kind?: 'crate';          // a wooden crate of loose boxes (no pallet base); absent for a pallet
}

export interface PlacedPallet {
  pallet: PalletPlan;
  stackedPallet?: PalletPlan;
  x: number;
  y: number;
  rotated: boolean;
  overflow: boolean;
}

export interface CustomerSummary {
  customerName: string;
  orderRef: string;
  totalCBM: number;
  totalGrossKg: number;
  palletCount: number;
}

// The pallets the engine assigned to one container of a split shipment
export interface ContainerLoad {
  palletIds: string[];
  cbm: number;
  grossKg: number;
}

export interface ShipmentResult {
  pallets: PalletPlan[];
  placed?: PlacedPallet[];
  perCustomer?: CustomerSummary[];   // optional — not always computed
  totalCBM: number;
  totalGrossKg: number;
  containerRecommendation: 'LCL' | 'FCL_20FT' | 'FCL_40FT' | 'MULTI_CONTAINER';
  warnings: string[];
  containersNeeded?: number;
  containerLoads?: ContainerLoad[];  // only for MULTI_CONTAINER; the first is the drawn floor plan
  preset?: RulePreset;               // rules the plan was packed with; absent on older saved results (standard)
  manualLayout?: boolean;            // placed holds positions moved by hand in the floor plan editor
}

// ─── Rule presets ────────────────────────────────────────────────────────────
// Pallet-level limits the engine packs to. Container payload caps never change.
export type RulePreset = 'standard' | 'relaxed' | 'freepack';

export interface PresetConfig {
  pumpPalletWidthMm: number;
  motorPalletWidthMm: number;
  maxPumpTotalHeightMm: number;
  maxMotorTotalHeightMm: number;
  maxPalletGrossKg: number;
  maxPalletLengthMm: number;   // max pallet footprint length (the dimension that runs along the container floor)
  allowCrossFamily: boolean;   // if true, pumps and motors can share a pallet
  motorsPerRow: number;        // motors side by side across a motor pallet
  motorQtyPerPallet: number;   // target motors per motor pallet; Infinity = limited by height/weight only
  v4MotorsInCrates: boolean;   // V4 motors go in wooden crates (no pallet base) instead of on pallets
  rotatePalletsOnFloor: boolean; // floor packing may turn pallets 90° and fill rows best-fit
}

// A pallet's floor position set by hand in the floor plan editor: mm from the
// container's front-left corner (x along the length, y across the width)
export interface FloorPosition {
  x: number;
  y: number;
}

export type PalletPositions = Record<string, FloorPosition>;
