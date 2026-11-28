import { PalletPlan } from '@/lib/types';
import { MAX_STACKABLE_PALLET_KG, MAX_STACKED_PAIR_KG } from '@/lib/constants';

// Stacked pair height cap, pending the loading team's forklift clearance check
export const MAX_STACKED_HEIGHT_MM = 2200;

function kg(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')}kg`;
}

// Why `top` may not go on `bottom`, or null if it may. These are the engine's
// stacking rules (canStack), shared with the floor plan editor so a stack made
// by hand is held to the same limits. The same for every preset.
export function stackingProblem(bottom: PalletPlan, top: PalletPlan): string | null {
  // Marketing material boxes stand alone: nothing on them, and never on anything
  const marketing = [bottom, top].find(p => p.kind === 'marketing');
  if (marketing) return `${marketing.palletId} is marketing material, which is not stackable`;
  // Fits within the bottom footprint
  if (top.lengthMm > bottom.lengthMm || top.widthMm > bottom.widthMm) {
    return `${top.palletId} (${top.lengthMm}×${top.widthMm}mm) doesn't fit on ${bottom.palletId} (${bottom.lengthMm}×${bottom.widthMm}mm)`;
  }
  // Whole-pallet stacking: heavier on floor (forklift stability).
  // Longest-at-bottom applies only to box layers within a pallet.
  if (bottom.totalGrossKg < top.totalGrossKg) {
    return `${top.palletId} (${kg(top.totalGrossKg)}) is heavier than ${bottom.palletId} (${kg(bottom.totalGrossKg)}); the heavier pallet goes at the bottom`;
  }
  // Forklift clearance
  if (bottom.heightMm + top.heightMm > MAX_STACKED_HEIGHT_MM) {
    return `stack would be ${(bottom.heightMm + top.heightMm).toLocaleString('en-US')}mm high, over the ${MAX_STACKED_HEIGHT_MM.toLocaleString('en-US')}mm limit`;
  }
  // Each pallet within the stacking limit
  const tooHeavy = [bottom, top].find(p => p.totalGrossKg > MAX_STACKABLE_PALLET_KG);
  if (tooHeavy) {
    return `${tooHeavy.palletId} is ${kg(tooHeavy.totalGrossKg)}, over the ${kg(MAX_STACKABLE_PALLET_KG)} limit for a stacked pallet`;
  }
  // Forklift capacity for the pair
  const pairKg = bottom.totalGrossKg + top.totalGrossKg;
  if (pairKg > MAX_STACKED_PAIR_KG) {
    return `combined ${kg(pairKg)} exceeds the ${kg(MAX_STACKED_PAIR_KG)} stacked-pair limit by ${kg(pairKg - MAX_STACKED_PAIR_KG)}`;
  }
  // Consignees kept apart
  if ((bottom.customer ?? '') !== (top.customer ?? '')) {
    return `${top.palletId} and ${bottom.palletId} belong to different customers`;
  }
  return null;
}
