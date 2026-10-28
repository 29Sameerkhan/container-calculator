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

export interface PalletPlan {
  palletId: string;
  customerName?: string;   // optional — not always set by engine
  orderRef?: string;       // optional — not always set by engine
  family: string;
  productCode: string;
  productCodes: string[];
  quantity: number;
  skuBreakdown?: Array<{ productCode: string; quantity: number; netWeightKg: number; grossWeightKg: number }>;
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

export interface ShipmentResult {
  pallets: PalletPlan[];
  placed?: PlacedPallet[];
  perCustomer?: CustomerSummary[];   // optional — not always computed
  totalCBM: number;
  totalGrossKg: number;
  containerRecommendation: 'LCL' | 'FCL_20FT' | 'FCL_40FT' | 'MULTI_CONTAINER';
  warnings: string[];
  containersNeeded?: number;
}