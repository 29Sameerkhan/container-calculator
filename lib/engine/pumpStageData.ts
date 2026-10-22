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
}

const PUMP_STAGE_DATA: Record<string, StageData> = {
  SK17: { basePumpLen: 336.5, lenPerStage: 60.5,  basePumpWt: 7.089,  wtPerStage: 0.9890, tubeOffset: 110, baseTubeWt: 1.7395, tubeWtPerStage: 0.1815, tubeW: 152, tubeH: 152 },
  SK30: { basePumpLen: 372,   lenPerStage: 96,     basePumpWt: 8.10,   wtPerStage: 1.8500, tubeOffset: 110, baseTubeWt: 1.846,  tubeWtPerStage: 0.2880, tubeW: 152, tubeH: 152 },
  SK46: { basePumpLen: 396,   lenPerStage: 113,    basePumpWt: 8.5775, wtPerStage: 1.7775, tubeOffset: 110, baseTubeWt: 1.918,  tubeWtPerStage: 0.3390, tubeW: 152, tubeH: 152 },
  SK60: { basePumpLen: 396,   lenPerStage: 113,    basePumpWt: 8.5225, wtPerStage: 1.7225, tubeOffset: 110, baseTubeWt: 1.918,  tubeWtPerStage: 0.3390, tubeW: 152, tubeH: 152 },
  SK09: { basePumpLen: 242,   lenPerStage: 50,     basePumpWt: 1.896,  wtPerStage: 0.4760, tubeOffset: 100, baseTubeWt: 0.6814, tubeWtPerStage: 0.0850, tubeW: 100, tubeH: 100 },
};

export const MIN_STAGES = 1;
export const MAX_STAGES = 20;

// Stage series for a pallet family, or null if its box is entered manually.
// SK09 is split into size families (SK09-large/-medium/-small) that share one series;
// SK60B uses the SK60 formula (confirmed by Yagnik).
export function stageSeriesFor(family: string): string | null {
  if (family in PUMP_STAGE_DATA) return family;
  if (family.startsWith('SK09-')) return 'SK09';
  if (family === 'SK60B') return 'SK60';
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
  return { L: Math.round(tubeLen), W: s.tubeW, H: s.tubeH, netKg: Math.round((pumpWt + tubeWt) * 1000) / 1000 };
}
