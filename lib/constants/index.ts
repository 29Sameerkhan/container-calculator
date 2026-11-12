// Container specs
export const CONTAINERS = {
  FCL_20FT: { maxCBM: 33.2, maxPayloadKg: 23000, tareKg: 2200 },
  FCL_40FT: { maxCBM: 67.6, maxPayloadKg: 28000, tareKg: 3900 },
};

// Pump pallet width lookup by family
export const PUMP_PALLET_WIDTH: Record<string, number> = {
  'SK77': 920, 'SK95': 920,
  'SK30': 770, 'SK46': 770,
  'SK12': 720, 'SK13': 720, 'SK14': 720,
  'SK17': 720, 'SK60': 720, 'SK60B': 720,
  'SK09-large': 770,
  'SK09-medium': 615, 'SK02': 615, 'SK03': 615,
  'SK05': 515, 'SK09-small': 515,
};

// Motor pallet width by series
// V4 = 6" CI motors (narrower pallet): 770mm — verified from SK-02 packing list pallet W=770
// V6 = 8" CI motors (wider pallet):   890mm — 5 motor boxes of 178mm across (was 1020 from SK-03 packing list)
export const MOTOR_PALLET_WIDTH: Record<string, number> = {
  'V4': 770,
  'V6': 890,
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
export const MAX_STACK_HEIGHT_MM = 2200;

// Wooden pallet base height (mm), added on top of stacked box height
export const PALLET_BASE_HEIGHT_MM = 180;

// Max gross weight per pallet (kg), wood included: pump and motor pallets alike.
// Raised from 1,000 kg on 12 Nov 2026.
export const MAX_PALLET_GROSS_KG = 1500;

// Max gross weight of a single pallet that may be placed on top of another.
// Mahendra confirmed: forklift rated 3,000 kg; each pallet up to 1,500 kg, 6 Nov 2026.
export const MAX_STACKABLE_PALLET_KG = 1500;

// Max combined gross weight of a stacked pair (bottom + top).
// Mahendra confirmed: 1,500 + 1,500 = 3,000 kg max pair, 6 Nov 2026.
export const MAX_STACKED_PAIR_KG = 3000;

export const MAX_PUMP_PALLET_LENGTH_MM = 3700;

// Below this total gross weight (kg) LCL is suggested instead of a full container:
// a load that fits a 20ft is recommended as LCL, a 40ft load gets a note
export const LCL_SUGGEST_BELOW_KG = 10000;