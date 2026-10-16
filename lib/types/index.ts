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
  /** Customer name — used for pallet consolidation grouping (items from different customers are never co-palletised) */
  customer?: string;
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
  /** All SKUs consolidated onto this pallet — length > 1 means mixed pallet */
  productCodes: string[];
  quantity: number;
  /** Per-SKU breakdown when isMixedSku=true */
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
  /** Customer this pallet belongs to — used for colour-coding in floor plan */
  customer?: string;
  /** True when this pallet is stacked two-high with another (see stackPallets) */
  isStacked?: boolean;
  /** palletId of the other pallet in the stack */
  stackedWith?: string;
  /** Position in the stack: the heavier pallet is always the bottom one */
  stackPosition?: 'bottom' | 'top';
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
  containersNeeded?: number; // set when MULTI_CONTAINER
}
