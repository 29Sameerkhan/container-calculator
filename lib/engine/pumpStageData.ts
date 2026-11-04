// Stage-based box size and net weight for pump families whose tube box grows
// with the number of stages. Lengths in mm, weights in kg.
//
// Lengths come from Yagnik's SLEKA PUMP LENGTH & TUBE LENGTH_30.10.2026 Excel:
// each table is pumpLength = base + perStage × stages, and the tube (the box)
// is pumpLength + tubeOffset. A series can have several tables, one per pump
// column (the NKaXb part of the item code, e.g. NK6X6) and stage range.

interface LengthTable {
  column: string;         // pump column from the item code, e.g. '4X4'
  fromStage: number;      // stage range of the Excel table
  toStage: number;
  base: number;           // pump length at 0 stages (the Excel formula's constant)
  perStage: number;
  tubeOffset: number;     // tube (box) length beyond the pump
}

interface WeightData {
  basePumpWt: number;     // 1-stage pump weight
  wtPerStage: number;
  baseTubeWt: number;     // 1-stage tube weight
  tubeWtPerStage: number;
  packingKg: number;      // box packing added to net for gross weight
}

interface SeriesData {
  // The first table for the stage count is used when the code names no column
  // (or one this series doesn't have)
  lengths: LengthTable[];
  tubeMm: number;         // square tube cross-section (box W = H)
  weight: WeightData | null; // null: no weight data yet, gross weight is entered by hand
}

const PUMP_STAGE_DATA: Record<string, SeriesData> = {
  // Tab SK02-03. 3 C.S. up to 33 stages, 4 C.S. from 34; SK03 also comes in a 6X4 column from 60.
  // Tube size not in the Excel: 100 mm assumed, as for SK09's 4X4 tube (to confirm with Yagnik)
  SK02: {
    lengths: [
      { column: '4X4', fromStage: 1,  toStage: 33, base: 159, perStage: 21, tubeOffset: 100 },
      { column: '4X4', fromStage: 34, toStage: 60, base: 191, perStage: 21, tubeOffset: 100 },
    ],
    tubeMm: 100,
    weight: null,
  },
  SK03: {
    lengths: [
      { column: '4X4', fromStage: 1,  toStage: 33, base: 159, perStage: 21, tubeOffset: 100 },
      { column: '4X4', fromStage: 34, toStage: 60, base: 191, perStage: 21, tubeOffset: 100 },
      { column: '6X4', fromStage: 60, toStage: 90, base: 242, perStage: 21, tubeOffset: 110 },
    ],
    tubeMm: 100,
    weight: null,
  },
  // Tab SK05. Same layout as SK02-03. The 6X4 table's tube is pump + 90 in the Excel, and its
  // 60-stage row uses base 211 while 65–85 use 242; 242 is used here (to confirm with Yagnik)
  SK05: {
    lengths: [
      { column: '4X4', fromStage: 1,  toStage: 33, base: 160, perStage: 24, tubeOffset: 100 },
      { column: '4X4', fromStage: 34, toStage: 60, base: 192, perStage: 24, tubeOffset: 100 },
      { column: '6X4', fromStage: 60, toStage: 85, base: 242, perStage: 24, tubeOffset: 90 },
    ],
    tubeMm: 100,
    weight: null,
  },
  SK09: {
    lengths: [
      { column: '4X4', fromStage: 1, toStage: 60, base: 224, perStage: 50, tubeOffset: 100 },
      { column: '6X4', fromStage: 1, toStage: 60, base: 240, perStage: 50, tubeOffset: 110 },
    ],
    tubeMm: 100,
    weight: { basePumpWt: 1.896, wtPerStage: 0.4760, baseTubeWt: 0.6814, tubeWtPerStage: 0.0850, packingKg: 1.0 },
  },
  // Tab SK12-14_6X6BC (SK13 and SK14 use it too)
  SK12: {
    lengths: [{ column: '6X6', fromStage: 1, toStage: 75, base: 281, perStage: 60.5, tubeOffset: 110 }],
    tubeMm: 152,
    weight: { basePumpWt: 7.079, wtPerStage: 0.9790, baseTubeWt: 1.7395, tubeWtPerStage: 0.1815, packingKg: 1.0 },
  },
  // Tabs SK17_6X6BC (1–75 stages) and SK17_4X6BC (1–20)
  SK17: {
    lengths: [
      { column: '6X6', fromStage: 1, toStage: 75, base: 281,   perStage: 60.5, tubeOffset: 110 },
      { column: '4X6', fromStage: 1, toStage: 20, base: 270.5, perStage: 60.5, tubeOffset: 100 },
    ],
    tubeMm: 152,
    weight: { basePumpWt: 7.089, wtPerStage: 0.9890, baseTubeWt: 1.7395, tubeWtPerStage: 0.1815, packingKg: 1.0 },
  },
  SK30: {
    lengths: [{ column: '6X6', fromStage: 1, toStage: 54, base: 281, perStage: 96, tubeOffset: 110 }],
    tubeMm: 152,
    weight: { basePumpWt: 8.10, wtPerStage: 1.8500, baseTubeWt: 1.846, tubeWtPerStage: 0.2880, packingKg: 1.0 },
  },
  SK46: {
    lengths: [{ column: '6X6', fromStage: 1, toStage: 34, base: 281, perStage: 113, tubeOffset: 110 }],
    tubeMm: 152,
    weight: { basePumpWt: 8.5775, wtPerStage: 1.7775, baseTubeWt: 1.918, tubeWtPerStage: 0.3390, packingKg: 1.0 },
  },
  SK60: {
    lengths: [{ column: '6X6', fromStage: 1, toStage: 28, base: 281, perStage: 113, tubeOffset: 110 }],
    tubeMm: 152,
    weight: { basePumpWt: 8.5225, wtPerStage: 1.7225, baseTubeWt: 1.918, tubeWtPerStage: 0.3390, packingKg: 1.0 },
  },
  // Tab SK77-6X8BC, 8" tube. Weight is the earlier SK77 sheet's total (pump + tube)
  // weight per stage: 24.635 kg at 1 stage, +15.7728 kg per stage
  SK77: {
    lengths: [{ column: '6X8', fromStage: 1, toStage: 28, base: 447, perStage: 128, tubeOffset: 120 }],
    tubeMm: 203,
    weight: { basePumpWt: 24.635, wtPerStage: 141.955 / 9, baseTubeWt: 0, tubeWtPerStage: 0, packingKg: 1.0 },
  },
};

// 8X6 column rows from the Excel (tab V6-8X6, plus the rows tagged 8X6 in the
// SK30/SK46/SK60 tabs). Not used yet: they apply to the 8" motor variant, and
// are kept here to switch on when the 8SK motor data arrives.
// Key: `${series}-${stages}`, values in mm as in the Excel.
export const SK_8X6_EXCEPTIONS: Record<string, { pumpLen: number; tubeLen: number }> = {
  'SK17-23': { pumpLen: 1728,   tubeLen: 1828 },
  'SK17-24': { pumpLen: 1788.5, tubeLen: 1888.5 },
  'SK17-27': { pumpLen: 1970,   tubeLen: 2070 },
  'SK30-3':  { pumpLen: 624.5,  tubeLen: 724.5 },
  'SK30-17': { pumpLen: 1968.5, tubeLen: 2068.5 },
  'SK30-26': { pumpLen: 2832.5, tubeLen: 2932.5 },
  'SK30-49': { pumpLen: 5040.5, tubeLen: 5140.5 },
  // SK30 54 stages appears twice: 5520.5 (+100 tube) in V6-8X6, 5518 (+110 tube) in the SK30 tab
  'SK30-54': { pumpLen: 5518,   tubeLen: 5628 },
  'SK46-3':  { pumpLen: 680,    tubeLen: 780 },
  'SK46-16': { pumpLen: 2149,   tubeLen: 2249 },
  'SK46-22': { pumpLen: 2827,   tubeLen: 2927 },
  'SK46-37': { pumpLen: 4521,   tubeLen: 4631 },
  'SK60-17': { pumpLen: 2262,   tubeLen: 2362 },
  'SK60-18': { pumpLen: 2375,   tubeLen: 2475 },
  'SK60-30': { pumpLen: 3731,   tubeLen: 3841 },
};

export const MIN_STAGES = 1;
// The longest tables run to 90 stages (SK03 6X4); boxes this long get a long
// pallet, and the engine warns when one passes the pallet length limit
export const MAX_STAGES = 90;

// Stage series for a pallet family, or null if its box is entered manually.
// SK09 is split into size families (SK09-large/-medium/-small) that share one series;
// SK60B uses the SK60 formula (confirmed by Yagnik); SK95 is the same pump as SK77;
// SK13 and SK14 use the SK12 formula (Excel tab SK12-14_6X6BC).
export function stageSeriesFor(family: string): string | null {
  if (family in PUMP_STAGE_DATA) return family;
  if (family.startsWith('SK09-')) return 'SK09';
  if (family === 'SK60B') return 'SK60';
  if (family === 'SK95') return 'SK77';
  if (family === 'SK13') return 'SK12';
  if (family === 'SK14') return 'SK12';
  return null;
}

// True when the series has weight data, so gross weight is filled from the formula
export function hasStageWeight(series: string): boolean {
  return PUMP_STAGE_DATA[series]?.weight != null;
}

export function isValidStages(stages: number | undefined): stages is number {
  return Number.isInteger(stages) && stages! >= MIN_STAGES && stages! <= MAX_STAGES;
}

// Pump column from an item code, e.g. SK17-07-NK6X6-25BC → '6X6'
export function pumpColumnFromCode(code: string): string | null {
  const m = code.toUpperCase().match(/NK(\d+)X(\d+)/);
  return m ? `${m[1]}X${m[2]}` : null;
}

// The length table for a stage count. When the code names a column this series
// has, that column's table is used (extended past its last stage if needed);
// otherwise the first listed table whose stage range covers the count, else the
// nearest table below it.
function lengthTableFor(s: SeriesData, stages: number, column: string | null): LengthTable {
  const inColumn = s.lengths.filter(t => t.column === column);
  const tables = inColumn.length > 0 ? inColumn : s.lengths;
  return tables.find(t => stages >= t.fromStage && stages <= t.toStage)
    ?? tables.filter(t => t.fromStage <= stages).pop()
    ?? tables[0];
}

// Pump length (mm, unrounded as in the Excel) — exported for the formula checks
export function pumpLength(series: string, stages: number, column: string | null = null): number | null {
  const s = PUMP_STAGE_DATA[series];
  if (!s) return null;
  const t = lengthTableFor(s, stages, column);
  return t.base + t.perStage * stages;
}

// Box for a stage count. netKg/grossKg are null when the series has no weight data yet.
export function calcPumpBox(series: string, stages: number, column: string | null = null) {
  const s = PUMP_STAGE_DATA[series];
  if (!s) return null;
  const t = lengthTableFor(s, stages, column);
  const tubeLen = t.base + t.perStage * stages + t.tubeOffset;
  const w = s.weight;
  const netKg = w
    ? Math.round((w.basePumpWt + (stages - 1) * w.wtPerStage + w.baseTubeWt + (stages - 1) * w.tubeWtPerStage) * 1000) / 1000
    : null;
  return {
    L: Math.round(tubeLen),
    W: s.tubeMm,
    H: s.tubeMm,
    netKg,
    grossKg: netKg !== null && w ? Math.round((netKg + w.packingKg) * 1000) / 1000 : null,
  };
}
