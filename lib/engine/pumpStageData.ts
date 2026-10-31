// Stage-based box size and net weight for pump families whose tube box grows
// with the number of stages. Lengths in mm, weights in kg.
interface StageData {
  basePumpLen: number;    // 1-stage pump length
  lenPerStage: number;
  basePumpWt: number;     // 1-stage pump weight
  wtPerStage: number;
  tubeOffset: number;     // tube (box) length beyond the pump
  baseTubeWt: number;     // 1-stage tube weight
  tubeWtPerStage: number;
  tubeW: number;          // tube cross-section
  tubeH: number;
  packingKg: number;      // box packing added to net for gross weight
}

const PUMP_STAGE_DATA: Record<string, StageData> = {
  SK17: { basePumpLen: 336.5, lenPerStage: 60.5,  basePumpWt: 7.089,  wtPerStage: 0.9890, tubeOffset: 110, baseTubeWt: 1.7395, tubeWtPerStage: 0.1815, tubeW: 152, tubeH: 152, packingKg: 1.0 },
  SK30: { basePumpLen: 372,   lenPerStage: 96,     basePumpWt: 8.10,   wtPerStage: 1.8500, tubeOffset: 110, baseTubeWt: 1.846,  tubeWtPerStage: 0.2880, tubeW: 152, tubeH: 152, packingKg: 1.0 },
  SK46: { basePumpLen: 396,   lenPerStage: 113,    basePumpWt: 8.5775, wtPerStage: 1.7775, tubeOffset: 110, baseTubeWt: 1.918,  tubeWtPerStage: 0.3390, tubeW: 152, tubeH: 152, packingKg: 1.0 },
  SK60: { basePumpLen: 396,   lenPerStage: 113,    basePumpWt: 8.5225, wtPerStage: 1.7225, tubeOffset: 110, baseTubeWt: 1.918,  tubeWtPerStage: 0.3390, tubeW: 152, tubeH: 152, packingKg: 1.0 },
  // SK77 (Excel SK77-6X8BC tab): 8x8 tube, 203 mm. The sheet gives tube length and
  // total weight per stage (682 mm / 24.635 kg at 1 stage, +128 mm / +15.7728 kg per stage),
  // so the whole length and weight sit in the pump terms
  SK77: { basePumpLen: 682,   lenPerStage: 128,    basePumpWt: 24.635, wtPerStage: 141.955 / 9, tubeOffset: 0, baseTubeWt: 0, tubeWtPerStage: 0, tubeW: 203, tubeH: 203, packingKg: 1.0 },
  SK09: { basePumpLen: 242,   lenPerStage: 50,     basePumpWt: 1.896,  wtPerStage: 0.4760, tubeOffset: 100, baseTubeWt: 0.6814, tubeWtPerStage: 0.0850, tubeW: 100, tubeH: 100, packingKg: 1.0 },
  SK12: { basePumpLen: 336.5, lenPerStage: 60.5,  basePumpWt: 7.079,  wtPerStage: 0.9790, tubeOffset: 110, baseTubeWt: 1.7395, tubeWtPerStage: 0.1815, tubeW: 152, tubeH: 152, packingKg: 1.0 },
};

export const MIN_STAGES = 1;
// Real codes go well past 20 (e.g. SK17-22-NK6X6-30NC, SK-09-52); boxes this long
// get a long pallet, and the engine warns when one passes the pallet length limit
export const MAX_STAGES = 60;

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

export function isValidStages(stages: number | undefined): stages is number {
  return Number.isInteger(stages) && stages! >= MIN_STAGES && stages! <= MAX_STAGES;
}

export function calcPumpBox(series: string, stages: number) {
  const s = PUMP_STAGE_DATA[series];
  if (!s) return null;
  const pumpLen = s.basePumpLen + (stages - 1) * s.lenPerStage;
  const tubeLen = pumpLen + s.tubeOffset;
  const pumpWt  = s.basePumpWt + (stages - 1) * s.wtPerStage;
  const tubeWt  = s.baseTubeWt + (stages - 1) * s.tubeWtPerStage;
  const netKg   = Math.round((pumpWt + tubeWt) * 1000) / 1000;
  return { L: Math.round(tubeLen), W: s.tubeW, H: s.tubeH, netKg, grossKg: Math.round((netKg + s.packingKg) * 1000) / 1000 };
}
