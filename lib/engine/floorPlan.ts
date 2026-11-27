import { PalletPlan, PalletPositions, PlacedPallet } from '@/lib/types';

export type { PlacedPallet };

export const CONTAINERS = {
  LCL:      { LENGTH: 0,     WIDTH: 2352, HEIGHT: 2393 },
  FCL_20FT: { LENGTH: 5898,  WIDTH: 2352, HEIGHT: 2393 },
  FCL_40FT: { LENGTH: 12032, WIDTH: 2352, HEIGHT: 2393 },
};

// One footprint on the container floor: a single pallet, or a stacked pair
// (bottom + top) treated as one pallet for floor packing
export interface FloorUnit {
  pallet: PalletPlan;
  stackedPallet?: PalletPlan;
  lengthMm: number; // longer of the two when stacked
  widthMm: number;  // the bottom pallet's; a top pallet is never wider
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

// The container a result's floor plan is drawn in, and the footprints on it: the
// engine's positions, or packed here for results saved before positions were
// stored. Null for LCL, which has no container floor.
export function floorLayout(
  pallets: PalletPlan[],
  recommendation: string,
  savedPlaced: PlacedPallet[] | undefined,
): { containerKey: 'FCL_20FT' | 'FCL_40FT'; containerLength: number; placed: PlacedPallet[] } | null {
  if (recommendation === 'LCL') return null;
  const containerKey = recommendation === 'FCL_20FT' ? 'FCL_20FT' : 'FCL_40FT';
  const containerLength = CONTAINERS[containerKey].LENGTH;
  return { containerKey, containerLength, placed: savedPlaced ?? packPallets(pallets, containerLength) };
}

// Side-view lane of each footprint: 0 nearest the left wall (y = 0). A footprint
// goes one lane behind the furthest-back footprint nearer the wall whose length
// along the container overlaps its own, so side views never draw two in one spot.
// For the auto layout this is each pallet's place across its strip.
export function sideLanes(placed: PlacedPallet[]): Map<PlacedPallet, number> {
  const lanes = new Map<PlacedPallet, number>();
  const byY = [...placed].sort((a, b) => a.y - b.y || a.x - b.x);
  byY.forEach((p, i) => {
    let lane = 0;
    for (const q of byY.slice(0, i)) {
      const alongOverlap = p.x < q.x + footprintLength(q) - TOUCH_TOLERANCE_MM &&
        q.x < p.x + footprintLength(p) - TOUCH_TOLERANCE_MM;
      if (alongOverlap) lane = Math.max(lane, (lanes.get(q) ?? 0) + 1);
    }
    lanes.set(p, lane);
  });
  return lanes;
}

// ─── Manual layout (floor plan editor) ───────────────────────────────────────

export const CONTAINER_INNER_WIDTH_MM = CONTAINERS.FCL_20FT.WIDTH;

// Pallets that only touch are fine: the auto layout packs them edge to edge
const TOUCH_TOLERANCE_MM = 1;

// The footprints at hand-set positions where given (keyed by the footprint's
// floor pallet), the engine's positions elsewhere. overflow is recomputed: true
// when any part of the footprint is off the container floor.
export function applyPositions(
  placed: PlacedPallet[],
  positions: PalletPositions | undefined,
  containerLength: number,
): PlacedPallet[] {
  if (!positions || Object.keys(positions).length === 0) return placed;
  return placed.map(p => {
    const pos = positions[p.pallet.palletId];
    if (!pos) return p;
    const moved = { ...p, x: pos.x, y: pos.y };
    return { ...moved, overflow: outsideByMm(moved, containerLength) > 0 };
  });
}

// How far (mm) a footprint reaches past the container floor on its worst side; 0 when inside
export function outsideByMm(p: PlacedPallet, containerLength: number): number {
  const len = footprintLength(p);
  return Math.max(
    0,
    -p.x,
    -p.y,
    p.x + len - containerLength,
    p.y + p.pallet.widthMm - CONTAINER_INNER_WIDTH_MM,
  );
}

function overlaps(a: PlacedPallet, b: PlacedPallet): boolean {
  return (
    a.x + footprintLength(a) - TOUCH_TOLERANCE_MM > b.x &&
    b.x + footprintLength(b) - TOUCH_TOLERANCE_MM > a.x &&
    a.y + a.pallet.widthMm - TOUCH_TOLERANCE_MM > b.y &&
    b.y + b.pallet.widthMm - TOUCH_TOLERANCE_MM > a.y
  );
}

export type LayoutIssueKind = 'overlap' | 'outside' | 'overweight';

export interface LayoutIssue {
  kind: LayoutIssueKind;
  // error blocks Save / Export; warning is shown but doesn't block
  severity: 'error' | 'warning';
  palletIds: string[];   // footprint floor-pallet ids to outline in red
  message: string;
}

// Footprint label: "SK-03", or "SK-03 + SK-07" for a stacked pair
export function footprintLabel(p: PlacedPallet): string {
  return p.stackedPallet ? `${p.pallet.palletId} + ${p.stackedPallet.palletId}` : p.pallet.palletId;
}

// Problems with a layout: footprints overlapping, footprints off the floor, and
// pallets over the preset's weight cap
export function validateLayout(
  placed: PlacedPallet[],
  containerLength: number,
  maxPalletGrossKg: number,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (!overlaps(a, b)) continue;
      issues.push({
        kind: 'overlap',
        severity: 'error',
        palletIds: [a.pallet.palletId, b.pallet.palletId],
        message: `[${footprintLabel(a)}] overlaps [${footprintLabel(b)}]. Pallets cannot occupy the same floor space.`,
      });
    }
  }
  for (const p of placed) {
    const out = Math.round(outsideByMm(p, containerLength));
    if (out > 0) {
      issues.push({
        kind: 'outside',
        severity: 'error',
        palletIds: [p.pallet.palletId],
        message: `[${footprintLabel(p)}] extends ${out.toLocaleString('en-US')}mm outside the container floor.`,
      });
    }
  }
  for (const p of placed) {
    for (const pallet of p.stackedPallet ? [p.pallet, p.stackedPallet] : [p.pallet]) {
      const over = Math.round(pallet.totalGrossKg - maxPalletGrossKg);
      if (over > 0) {
        issues.push({
          kind: 'overweight',
          severity: 'warning',
          palletIds: [p.pallet.palletId],
          message: `[${pallet.palletId}] ${Math.round(pallet.totalGrossKg).toLocaleString('en-US')}kg — exceeds ` +
            `${maxPalletGrossKg.toLocaleString('en-US')}kg limit by ${over.toLocaleString('en-US')}kg`,
        });
      }
    }
  }
  return issues;
}
