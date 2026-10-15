export interface OrderItem {
  productCode: string;
  productType: 'pump' | 'motor-V4' | 'motor-V6' | 'controller' | 'spare';
  palletFamily: string;
  quantity: number;
  boxLengthMm: number;
  boxWidthMm: number;
  boxHeightMm: number;
  netWeightKg: number;   // per box
  grossWeightKg: number; // per box
  // fallback: weight entered manually if ERP missing
  weightManualEntry?: boolean;
}

export interface PalletPlan {
  palletId: string;
  family: string;
  productCode: string;
  quantity: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  cbm: number;
  netWeightKg: number;
  grossWeightKg: number;
  woodWeightKg: number;
  totalGrossKg: number;
  isMixedSku: boolean;
}

export interface ShipmentResult {
  pallets: PalletPlan[];
  totalCBM: number;
  totalGrossKg: number;
  containerRecommendation: 'LCL' | 'FCL_20FT' | 'FCL_40FT' | 'MULTI_CONTAINER';
  warnings: string[];
}
