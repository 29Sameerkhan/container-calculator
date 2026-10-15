import { PalletPlan } from '@/lib/types';

export interface PlacedPallet {
  pallet: PalletPlan;
  x: number;       // mm from container front-left
  y: number;       // mm from container left wall (top-down view)
  rotated: boolean;
}

// 40ft container internal dims (mm)
const C_LENGTH = 11998;
const C_WIDTH  = 2352;
const C_HEIGHT = 2393;

// Strip-pack: sort by length desc, pair side-by-side if W1+W2 ≤ C_WIDTH, else solo strip
export function packPallets(pallets: PalletPlan[]): PlacedPallet[] {
  const sorted = [...pallets].sort((a, b) => b.lengthMm - a.lengthMm);
  const placed: PlacedPallet[] = [];
  let cursor = 0; // mm from front of container
  let i = 0;

  while (i < sorted.length) {
    const a = sorted[i];
    const b = sorted[i + 1];

    const canPair = b && (a.widthMm + b.widthMm) <= C_WIDTH;

    if (canPair) {
      // Place a on left, b on right
      placed.push({ pallet: a, x: cursor, y: 0, rotated: false });
      placed.push({ pallet: b, x: cursor, y: a.widthMm, rotated: false });
      cursor += Math.max(a.lengthMm, b.lengthMm);
      i += 2;
    } else {
      placed.push({ pallet: a, x: cursor, y: 0, rotated: false });
      cursor += a.lengthMm;
      i += 1;
    }
  }

  return placed;
}

export const CONTAINER = { LENGTH: C_LENGTH, WIDTH: C_WIDTH, HEIGHT: C_HEIGHT };
