import type { PresetConfig, RulePreset } from '@/lib/types';

// Container specs
export const CONTAINERS = {
  FCL_20FT: { maxCBM: 33.2, maxPayloadKg: 23000, tareKg: 2200 },
  FCL_40FT: { maxCBM: 67.6, maxPayloadKg: 28000, tareKg: 3900 },
};

// Pump pallet families the calculator knows (pick list and code recognition)
export const PUMP_PALLET_FAMILIES: string[] = [
  'SK77', 'SK95',
  'SK30', 'SK46',
  'SK12', 'SK13', 'SK14',
  'SK17', 'SK60', 'SK60B',
  'SK09-large',
  'SK09-medium', 'SK02', 'SK03',
  'SK05', 'SK09-small',
];

// Pump pallet width (mm), one size for every family.
// Standardised per Kiran sir, 19 Nov 2026
export const PUMP_PALLET_WIDTH_MM = 1030;

// Motor pallet width (mm), one size for every motor series.
// Standardised per Kiran sir, 19 Nov 2026
export const MOTOR_PALLET_WIDTH_MM = 750;

// Motors packed side-by-side across a motor pallet: always 3, not derived from box width.
// Standardised per Kiran sir, 19 Nov 2026
export const MOTORS_PER_ROW = 3;

// Wood weight constants (kg)
export const WOOD_WEIGHT = {
  MOTOR_SINGLE_SKU: 20,
  MOTOR_MIXED_SKU: 25,
  PUMP_LIGHT: 25,
  PUMP_HEAVY: 30,  // SK77/SK95 family
  BOX_ACCESSORY: 10,
};

// Max pump pallet height (mm), total from floor: wood base + boxes (870mm of boxes).
// Standardised per Kiran sir, 19 Nov 2026
export const MAX_PUMP_TOTAL_HEIGHT_MM = 1050;

// Max motor pallet height (mm), total from floor: wood base + boxes (900mm of boxes).
// Standardised per Kiran sir, 19 Nov 2026
export const MAX_MOTOR_TOTAL_HEIGHT_MM = 1080;

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

// ─── Rule presets ────────────────────────────────────────────────────────────
// Pallet-level limits only. The container payload caps in CONTAINERS
// (20ft: 23,000 kg, 40ft: 28,000 kg) apply under every preset and are never relaxed.
export const PRESET_CONFIGS: Record<RulePreset, PresetConfig> = {
  // The standardised rules above (Kiran sir, 19 Nov 2026)
  standard: {
    pumpPalletWidthMm: PUMP_PALLET_WIDTH_MM,
    motorPalletWidthMm: MOTOR_PALLET_WIDTH_MM,
    maxPumpTotalHeightMm: MAX_PUMP_TOTAL_HEIGHT_MM,
    maxMotorTotalHeightMm: MAX_MOTOR_TOTAL_HEIGHT_MM,
    maxPalletGrossKg: MAX_PALLET_GROSS_KG,
    maxPalletLengthMm: Infinity,   // current behaviour, no cap
    allowCrossFamily: false,
  },
  relaxed: {
    pumpPalletWidthMm: 1030,
    motorPalletWidthMm: 750,
    maxPumpTotalHeightMm: 1500,
    maxMotorTotalHeightMm: 1500,
    maxPalletGrossKg: 2000,
    maxPalletLengthMm: Infinity,   // relaxed changes height and weight only
    allowCrossFamily: false,
  },
  // Factory-style packing
  freepack: {
    pumpPalletWidthMm: 1110,
    motorPalletWidthMm: 1110,
    maxPumpTotalHeightMm: 1770,
    maxMotorTotalHeightMm: 1770,
    maxPalletGrossKg: 2000,
    // Factory practice: the longest pump pallet is ~1,640mm; 160mm margin
    maxPalletLengthMm: 1800,
    allowCrossFamily: true,
  },
};

export const DEFAULT_PRESET: RulePreset = 'standard';

export const RULE_PRESETS: RulePreset[] = ['standard', 'relaxed', 'freepack'];

export const PRESET_LABELS: Record<RulePreset, string> = {
  standard: 'Standard',
  relaxed: 'Relaxed',
  freepack: 'Freepack',
};

// One line on what each preset changes compared with Standard
export const PRESET_SUMMARIES: Record<RulePreset, string> = {
  standard: 'Pump 1,030mm · Motor 750mm wide · Height 1,050 / 1,080mm · Max pallet weight 1,500kg',
  relaxed: 'Height cap raised to 1,500mm · Max pallet weight 2,000kg',
  freepack: 'Factory-style · 1,110mm wide · 1,770mm height · max 1,800mm long · mixed families allowed',
};

export function isRulePreset(value: unknown): value is RulePreset {
  return typeof value === 'string' && (RULE_PRESETS as string[]).includes(value);
}
