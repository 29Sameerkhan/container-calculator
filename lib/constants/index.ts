// Container specs
export const CONTAINERS = {
  FCL_20FT: { maxCBM: 33.2, maxPayloadKg: 23000, tareKg: 2200 },
  FCL_40FT: { maxCBM: 67.6, maxPayloadKg: 28000, tareKg: 3900 },
};

// Pump pallet width lookup by family
export const PUMP_PALLET_WIDTH: Record<string, number> = {
  'SK77': 920, 'SK95': 920, 'SK95A': 920, 'SK95B': 920,
  'SK30': 770, 'SK46': 770,
  'SK17': 720, 'SK60': 720, 'SK60B': 720,
  'SK09-large': 770,
  'SK09-medium': 615, 'SK02': 615, 'SK03': 615,
  'SK05': 515, 'SK09-small': 515,
};

// Motor pallet width by voltage series
export const MOTOR_PALLET_WIDTH: Record<string, number> = {
  'V4': 1120,
  'V6': 715,
};

// Wood weight constants (kg)
export const WOOD_WEIGHT = {
  MOTOR_SINGLE_SKU: 20,
  MOTOR_MIXED_SKU: 25,
  PUMP_LIGHT: 25,
  PUMP_HEAVY: 30,  // SK77/SK95 family
  BOX_ACCESSORY: 10,
};

// Max stacking height inside container (mm)
export const MAX_STACK_HEIGHT_MM = 2350;

// Wooden pallet base height (mm), added on top of stacked box height
export const PALLET_BASE_HEIGHT_MM = 120;

// Recommendation bands by total CBM:
// ≤ LCL_MAX_CBM → LCL, ≤ FCL_20FT_BAND_MAX_CBM → 20ft, ≤ 40ft maxCBM → 40ft, above → multiple containers
export const LCL_MAX_CBM = 15;
export const FCL_20FT_BAND_MAX_CBM = 25;

// Container internal lengths (mm)
export const CONTAINER_LENGTH_MM = { FCL_20FT: 5898, FCL_40FT: 11998 };
