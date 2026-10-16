import { PalletPlan } from '@/lib/types';

export interface PlacedPallet {
  pallet: PalletPlan;      // the floor pallet (bottom of a stack)
  stackedPallet?: PalletPlan; // pallet sitting on top of it, if stacked
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

// One footprint on the container floor: a single pallet, or a stacked pair
// (bottom + top) treated as one pallet for floor packing
export interface FloorUnit {
  pallet: PalletPlan;
  stackedPallet?: PalletPlan;
  lengthMm: number; // longer of the two when stacked
  widthMm: number;  // stacked pallets always share a width
}

// Group pallets into floor footprints using the stack pairing set by the engine.
// A top pallet whose bottom isn't in the list is kept as its own footprint.
export function toFloorUnits(pallets: PalletPlan[]): FloorUnit[] {
  const byId = new Map(pallets.map(p => [p.palletId, p]));
  const units: FloorUnit[] = [];
  for (const p of pallets) {
    const partner = p.isStacked && p.stackedWith ? byId.get(p.stackedWith) : undefined;
    if (partner && p.stackPosition === 'top') continue; // placed together with its bottom
    const top = partner && p.stackPosition === 'bottom' ? partner : undefined;
    units.push({
      pallet: p,
      stackedPallet: top,
      lengthMm: Math.max(p.lengthMm, top?.lengthMm ?? 0),
      widthMm: p.widthMm,
    });
  }
  return units;
}

// Row-fill strip packing:
// Sort by length desc. Fill each strip (row) by adding pallets side-by-side
// until the next one won't fit in the remaining width. Then advance cursor by
// the tallest pallet in that strip and start a new strip.
// Stacked pairs occupy a single footprint.
export function packPallets(
  pallets: PalletPlan[],
  containerLength: number
): PlacedPallet[] {
  const C_WIDTH = 2352;
  const sorted = toFloorUnits(pallets).sort((a, b) => b.lengthMm - a.lengthMm);
  const placed: PlacedPallet[] = [];
  let cursor = 0; // mm from container front
  let i = 0;

  const place = (u: FloorUnit, y: number) => placed.push({
    pallet: u.pallet,
    stackedPallet: u.stackedPallet,
    x: cursor,
    y,
    rotated: false,
    overflow: cursor + u.lengthMm > containerLength,
  });

  while (i < sorted.length) {
    // Fill one strip
    let y = 0;
    let stripMaxLength = 0;
    const stripStart = i;

    while (i < sorted.length) {
      const u = sorted[i];
      if (y + u.widthMm > C_WIDTH) break; // won't fit in this strip
      place(u, y);
      y += u.widthMm;
      if (u.lengthMm > stripMaxLength) stripMaxLength = u.lengthMm;
      i++;
    }

    if (i === stripStart) {
      // Safety: pallet wider than container — place it anyway and advance
      const u = sorted[i];
      place(u, 0);
      stripMaxLength = u.lengthMm;
      i++;
    }

    cursor += stripMaxLength;
  }

  return placed;
}

// Floor length taken by a placed footprint (the longer pallet of a stack)
export function footprintLength(p: PlacedPallet): number {
  return Math.max(p.pallet.lengthMm, p.stackedPallet?.lengthMm ?? 0);
}
