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

// Motor pallet width by series
// V4 = 6" CI motors (narrower pallet): 770mm — verified from SK-02 packing list pallet W=770
// V6 = 8" CI motors (wider pallet):   1020mm — verified from SK-03 packing list pallet W=1020
export const MOTOR_PALLET_WIDTH: Record<string, number> = {
  'V4': 770,
  'V6': 1020,
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

// Container internal lengths (mm)
export const CONTAINER_LENGTH_MM = { FCL_20FT: 5898, FCL_40FT: 11998 };

// Max gross weight per pallet (kg) — safe working load for a standard 2-tonne counterbalance forklift.
// 1,500 kg is conservative: accounts for height-lift penalties and off-centre load