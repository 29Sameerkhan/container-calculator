import { PalletPlan } from '@/lib/types';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

// One colour per pallet family, in first-seen order, so a family has the same
// colour in the floor plan, the side view and the 3D view
export function familyColorMap(pallets: PalletPlan[]): Record<string, string> {
  const colors: Record<string, string> = {};
  let colorIdx = 0;
  for (const p of pallets) {
    if (!colors[p.family]) {
      colors[p.family] = COLORS[colorIdx % COLORS.length];
      colorIdx++;
    }
  }
  return colors;
}
