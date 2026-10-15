import { PalletPlan } from '@/lib/types';

export interface PlacedPallet {
  pallet: PalletPlan;
  x: number;
  y: number;
  rotated: boolean;
}

// Container internal dims (mm)
export const CONTAINERS = {
  LCL:      { LENGTH: 0,      WIDTH: 2352, HEIGHT: 2393 }, // no floor plan for LCL
  FCL_20FT: { LENGTH: 5898,   WIDTH: 2352, HEIGHT: 2393 },
  FCL_40FT: { LENGTH: 11998,  WIDTH: 2352, HEIGHT: 2393 },
};

export function packPallets(
  pallets: PalletPlan[],
  containerLength: number
): PlacedPallet[] {
  const sorted = [...pallets].sort((a, b) => b.lengthMm - a.lengthMm);
  const placed: PlacedPallet[] = [];
  const C_WIDTH = 2352;
  let cursor = 0;
  let i = 0;

  while (i < sorted.length) {
    const a = sorted[i];
    const b = sorted[i + 1];

    // Don't place past the container length
    if (cursor + a.lengthMm > containerLength) {
      // overflow — still place it so the UI can flag it red
      placed.push({ pallet: a, x: cursor, y: 0, rotated: false });
      i++;
      continue;
    }

    const canPair = b && (a.widthMm + b.widthMm) <= C_WIDTH;

    if (canPair) {
      placed.push({ pallet: a, x: cursor, y: 0,          rotated: false });
      placed.push({ pallet: b, x: cursor, y: a.widthMm,  rotated: false });
      cursor += Math.max(a.lengthMm, b.lengthMm);
      i += 2;
    } else {
      placed.push({ pallet: a, x: cursor, y: 0, rotated: false });
      cursor += a.lengthMm;
      i++;
    }
  }

  return placed;
}
