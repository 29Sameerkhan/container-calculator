import { PalletPlan } from '@/lib/types';

export interface PlacedPallet {
  pallet: PalletPlan;
  x: number;       // mm from container front
  y: number;       // mm from left wall
  rotated: boolean;
  overflow: boolean; // true if past container length
}

export const CONTAINERS = {
  LCL:      { LENGTH: 0,     WIDTH: 2352, HEIGHT: 2393 },
  FCL_20FT: { LENGTH: 5898,  WIDTH: 2352, HEIGHT: 2393 },
  FCL_40FT: { LENGTH: 11998, WIDTH: 2352, HEIGHT: 2393 },
};

// Row-fill strip packing:
// Sort by length desc. Fill each strip (row) by adding pallets side-by-side
// until the next one won't fit in the remaining width. Then advance cursor by
// the tallest pallet in that strip and start a new strip.
export function packPallets(
  pallets: PalletPlan[],
  containerLength: number
): PlacedPallet[] {
  const C_WIDTH = 2352;
  const sorted = [...pallets].sort((a, b) => b.lengthMm - a.lengthMm);
  const placed: PlacedPallet[] = [];
  let cursor = 0; // mm from container front
  let i = 0;

  while (i < sorted.length) {
    // Fill one strip
    let y = 0;
    let stripMaxLength = 0;
    const stripStart = i;

    while (i < sorted.length) {
      const p = sorted[i];
      if (y + p.widthMm > C_WIDTH) break; // won't fit in this strip
      placed.push({
        pallet: p,
        x: cursor,
        y,
        rotated: false,
        overflow: cursor + p.lengthMm > containerLength,
      });
      y += p.widthMm;
      if (p.lengthMm > stripMaxLength) stripMaxLength = p.lengthMm;
      i++;
    }

    if (i === stripStart) {
      // Safety: pallet wider than container — place it anyway and advance
      const p = sorted[i];
      placed.push({ pallet: p, x: cursor, y: 0, rotated: false, overflow: cursor + p.lengthMm > containerLength });
      stripMaxLength = p.lengthMm;
      i++;
    }

    cursor += stripMaxLength;
  }

  return placed;
}
