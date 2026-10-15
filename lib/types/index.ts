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

// A customer order: the header details plus its product lines
export interface ShipmentOrder {
  customerName: string;
  orderRef: string;
  items: OrderItem[];
}

export interface PalletPlan {
  palletId: string;
  // Which order this pallet belongs to (a shipment can consolidate several orders)
  customerName: string;
  orderRef: string;
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

// Totals for one order within a shipment
export interface CustomerSummary {
  customerName: string;
  orderRef: string;
  totalCBM: number;
  totalGrossKg: number;
  palletCount: number;
}

export interface ShipmentResult {
  pallets: PalletPlan[];
  perCustomer: CustomerSummary[];
  totalCBM: number;
  totalGrossKg: number;
  containerRecommendation: 'LCL' | 'FCL_20FT' | 'FCL_40FT' | 'MULTI_CONTAINER';
  warnings: string[];
}
