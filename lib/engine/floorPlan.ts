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

// Floor length taken by a placed footprint along the container (the longer pallet
// of a stack). A footprint turned 90° (rotated) has its width along the container.
export function footprintLength(p: PlacedPallet): number {
  const palletLength = Math.max(p.pallet.lengthMm, p.stackedPallet?.lengthMm ?? 0);
  return p.rotated ? p.pallet.widthMm : palletLength;
}

// Floor width taken by a placed footprint across the container
export function footprintWidth(p: PlacedPallet): number {
  return p.rotated ? Math.max(p.pallet.lengthMm, p.stackedPallet?.lengthMm ?? 0) : p.pallet.widthMm;
}

// ─── Row packing with turning (Freepack) ─────────────────────────────────────
// Like packPallets it fills rows across the container, front to back, but a
// footprint may be turned 90°, a row takes any footprint that fits its depth and
// the width left (not just the next in length order), and several ways of
// building each row are kept and compared (a small beam search), so the layout
// that ends nearest the front wins.

interface Orientation { along: number; across: number; rotated: boolean }
interface RowItem { unit: FloorUnit; o: Orientation; y: number }
interface Row { depth: number; items: RowItem[] }

const BEAM_WIDTH = 8;
const LEADER_CHOICES = 3;

function orientations(u: FloorUnit, containerWidth: number): Orientation[] {
  const upright = { along: u.lengthMm, across: u.widthMm, rotated: false };
  const turned = { along: u.widthMm, across: u.lengthMm, rotated: true };
  const all = u.lengthMm === u.widthMm ? [upright] : [upright, turned];
  const fitting = all.filter(o => o.across <= containerWidth);
  // Wider than the container either way: placed upright anyway (flagged as overflow later)
  return fitting.length > 0 ? fitting : [upright];
}

// One row started by `leader` in orientation `lo`, filled from `pool` with the
// footprints that fit: 'area' takes the biggest footprint first, 'deep' the one
// that fills the row's depth best
function buildRow(leader: FloorUnit, lo: Orientation, pool: FloorUnit[], strategy: 'area' | 'deep', containerWidth: number): Row {
  const items: RowItem[] = [{ unit: leader, o: lo, y: 0 }];
  let used = lo.across;
  const left = pool.filter(u => u !== leader);
  for (;;) {
    let best: { unit: FloorUnit; o: Orientation; score: number } | null = null;
    for (const unit of left) {
      for (const o of orientations(unit, containerWidth)) {
        if (o.along > lo.along || used + o.across > containerWidth) continue;
        // Ties go to the narrower orientation, leaving more width for the rest
        const score = (strategy === 'area' ? unit.lengthMm * unit.widthMm : o.along) * 1e4 - o.across;
        if (!best || score > best.score) best = { unit, o, score };
      }
    }
    if (!best) break;
    items.push({ unit: best.unit, o: best.o, y: used });
    used += best.o.across;
    left.splice(left.indexOf(best.unit), 1);
  }
  return { depth: lo.along, items };
}

export function packPalletsTurning(pallets: PalletPlan[], containerLength: number): PlacedPallet[] {
  const containerWidth = CONTAINER_INNER_WIDTH_MM;
  const area = (u: FloorUnit) => u.lengthMm * u.widthMm;
  interface State { rows: Row[]; left: FloorUnit[]; depth: number; leftArea: number }
  const start = toFloorUnits(pallets).sort((a, b) => area(b) - area(a));
  let beam: State[] = [{ rows: [], left: start, depth: 0, leftArea: start.reduce((s, u) => s + area(u), 0) }];
  const finished: State[] = [];

  while (beam.length > 0) {
    const next: State[] = [];
    for (const state of beam) {
      if (state.left.length === 0) {
        finished.push(state);
        continue;
      }
      // Leaders: the largest few footprints still to place, one per distinct size
      const leaders: FloorUnit[] = [];
      for (const u of state.left) {
        if (leaders.some(l => l.lengthMm === u.lengthMm && l.widthMm === u.widthMm)) continue;
        leaders.push(u);
        if (leaders.length === LEADER_CHOICES) break;
      }
      for (const leader of leaders) {
        for (const lo of orientations(leader, containerWidth)) {
          for (const strategy of ['area', 'deep'] as const) {
            const row = buildRow(leader, lo, state.left, strategy, containerWidth);
            const placedUnits = new Set(row.items.map(i => i.unit));
            const left = state.left.filter(u => !placedUnits.has(u));
            next.push({
              rows: [...state.rows, row],
              left,
              depth: state.depth + row.depth,
              leftArea: left.reduce((s, u) => s + area(u), 0),
            });
          }
        }
      }
    }
    // Keep the most promising: depth so far plus the least depth the rest could need
    const seen = new Set<string>();
    beam = next
      .sort((a, b) => (a.depth + a.leftArea / containerWidth) - (b.depth + b.leftArea / containerWidth))
      .filter(s => {
        const key = `${s.depth}|${s.left.map(u => u.pallet.palletId).join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, BEAM_WIDTH);
  }

  const best = finished.sort((a, b) => a.depth - b.depth)[0];
  const placed: PlacedPallet[] = [];
  let cursor = 0;
  for (const row of best?.rows ?? []) {
    for (const { unit, o, y } of row.items) {
      placed.push({
        pallet: unit.pallet,
        stackedPallet: unit.stackedPallet,
        x: cursor,
        y,
        rotated: o.rotated,
        overflow: cursor + o.along > containerLength,
      });
    }
    cursor += row.depth;
  }
  return placed;
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
    p.y + footprintWidth(p) - CONTAINER_INNER_WIDTH_MM,
  );
}

function overlaps(a: PlacedPallet, b: PlacedPallet): boolean {
  return (
    a.x + footprintLength(a) - TOUCH_TOLERANCE_MM > b.x &&
    b.x + footprintLength(b) - TOUCH_TOLERANCE_MM > a.x &&
    a.y + footprintWidth(a) - TOUCH_TOLERANCE_MM > b.y &&
    b.y + footprintWidth(b) - TOUCH_TOLERANCE_MM > a.y
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
