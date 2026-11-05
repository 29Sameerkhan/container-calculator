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
  rows: number;
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
}