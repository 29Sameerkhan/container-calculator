import { PalletPlan, PalletPositions, PlacedPallet } from '@/lib/types';
import { MAX_STACKED_HEIGHT_MM } from '@/lib/engine/stacking';
import { MAX_STACKABLE_PALLET_KG, MAX_STACKED_PAIR_KG } from '@/lib/constants';

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
  // A stack's top pallet with an entry of its own has been taken off: it becomes
  // a footprint of its own (same orientation), placed by its entry below
  let units = placed.flatMap(u => {
    const top = u.stackedPallet;
    if (!top || !positions[top.palletId]) return [u];
    return [{ ...u, stackedPallet: undefined }, { pallet: top, x: u.x, y: u.y, rotated: u.rotated, overflow: false }];
  });
  // Stacks made by hand next: the top pallet's footprint joins its bottom's.
  // An entry that no longer matches two single pallets is ignored.
  for (const [topId, pos] of Object.entries(positions)) {
    if (!pos.stackedOn) continue;
    const top = units.find(u => u.pallet.palletId === topId && !u.stackedPallet);
    const bottom = units.find(u => u.pallet.palletId === pos.stackedOn && !u.stackedPallet);
    if (!top || !bottom || top === bottom) continue;
    units = units
      .filter(u => u !== top)
      .map(u => (u === bottom ? { ...u, stackedPallet: top.pallet } : u));
  }
  return units.map(p => {
    const pos = positions[p.pallet.palletId];
    if (!pos || pos.stackedOn) return p;
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

// The free spot on the container floor nearest `near` for a footprint this
// long and wide (along × across), flush against walls or other footprints, or
// null when none is free
export function findFreeSpot(
  others: PlacedPallet[],
  lengthMm: number,
  widthMm: number,
  near: { x: number; y: number },
  containerLength: number,
): { x: number; y: number } | null {
  const xs = new Set([0, containerLength - lengthMm, near.x]);
  const ys = new Set([0, CONTAINER_INNER_WIDTH_MM - widthMm, near.y]);
  for (const o of others) {
    xs.add(o.x + footprintLength(o)); xs.add(o.x - lengthMm); xs.add(o.x);
    ys.add(o.y + footprintWidth(o)); ys.add(o.y - widthMm); ys.add(o.y);
  }
  let best: { x: number; y: number; d: number } | null = null;
  for (const x of Array.from(xs)) {
    if (x < 0 || x + lengthMm > containerLength) continue;
    for (const y of Array.from(ys)) {
      if (y < 0 || y + widthMm > CONTAINER_INNER_WIDTH_MM) continue;
      const blocked = others.some(o =>
        x + lengthMm - TOUCH_TOLERANCE_MM > o.x && o.x + footprintLength(o) - TOUCH_TOLERANCE_MM > x &&
        y + widthMm - TOUCH_TOLERANCE_MM > o.y && o.y + footprintWidth(o) - TOUCH_TOLERANCE_MM > y);
      if (blocked) continue;
      const d = Math.hypot(x - near.x, y - near.y);
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  return best && { x: best.x, y: best.y };
}

export function overlaps(a: PlacedPallet, b: PlacedPallet): boolean {
  return (
    a.x + footprintLength(a) - TOUCH_TOLERANCE_MM > b.x &&
    b.x + footprintLength(b) - TOUCH_TOLERANCE_MM > a.x &&
    a.y + footprintWidth(a) - TOUCH_TOLERANCE_MM > b.y &&
    b.y + footprintWidth(b) - TOUCH_TOLERANCE_MM > a.y
  );
}

// overload (orange): a stack over a weight limit or the forklift clearance height;
// height-overflow (red): a stack taller than the container interior
export type LayoutIssueKind = 'overlap' | 'outside' | 'overweight' | 'overload' | 'height-overflow';

export interface LayoutIssue {
  kind: LayoutIssueKind;
  // error blocks Save / Export; warning is shown but doesn't block
  severity: 'error' | 'warning';
  palletIds: string[];   // footprint floor-pallet ids to outline in red
  message: string;
}

// Which of two pallets goes at the bottom of a hand-made stack: a marketing
// material box always goes on top; otherwise the heavier pallet is the bottom
export function stackOrder(a: PalletPlan, b: PalletPlan): [bottom: PalletPlan, top: PalletPlan] {
  if (a.kind === 'marketing' && b.kind !== 'marketing') return [b, a];
  if (b.kind === 'marketing' && a.kind !== 'marketing') return [a, b];
  return a.totalGrossKg >= b.totalGrossKg ? [a, b] : [b, a];
}

// Why `moved` can't be stacked by hand with `target`, the footprint it was
// dropped on. Only the hard rules block: a footprint that is already a pair can't
// take a third pallet, nothing goes on top of a marketing material box (a box may
// be dropped onto a pallet, never a pallet onto a box), the top must fit on the
// bottom, and consignees stay apart. Weight and height limits never block a
// hand-made stack; stackWarnings flags them instead. The engine keeps its own
// stricter rules (stackingProblem) and never stacks marketing material itself.
// Null when they can be stacked.
export function stackRefusal(moved: PlacedPallet, target: PlacedPallet): string | null {
  const pair = [moved, target].find(p => p.stackedPallet);
  if (pair) return `${footprintLabel(pair)} is already a stacked pair (no triple stacking)`;
  if (target.pallet.kind === 'marketing') {
    return `nothing can be stacked on ${target.pallet.palletId}: it is marketing material (a marketing box can only go on top of a pallet)`;
  }
  const [bottom, top] = stackOrder(moved.pallet, target.pallet);
  if (top.lengthMm > bottom.lengthMm || top.widthMm > bottom.widthMm) {
    return `${top.palletId} (${top.lengthMm}×${top.widthMm}mm) doesn't fit on ${bottom.palletId} (${bottom.lengthMm}×${bottom.widthMm}mm)`;
  }
  if ((bottom.customer ?? '') !== (top.customer ?? '')) {
    return `${top.palletId} and ${bottom.palletId} belong to different customers`;
  }
  return null;
}

// Where a marketing box on top of a pallet sits: centred on the pallet, in floor
// coordinates (x along the container, y across), with its floor-plan size
export function topBoxRect(p: PlacedPallet): { x: number; y: number; len: number; wid: number } | null {
  const top = p.stackedPallet;
  if (!top || top.kind !== 'marketing') return null;
  const len = p.rotated ? top.widthMm : top.lengthMm;
  const wid = p.rotated ? top.lengthMm : top.widthMm;
  return { x: p.x + (footprintLength(p) - len) / 2, y: p.y + (footprintWidth(p) - wid) / 2, len, wid };
}

// Interior height of every container (mm): a stack taller than this sticks out
export const CONTAINER_INNER_HEIGHT_MM = CONTAINERS.FCL_20FT.HEIGHT;

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export interface StackWarning {
  kind: 'overload' | 'height-overflow';
  message: string;
}

// Limits a stacked pair breaks, as warnings (none for a single pallet):
// overload when the pair or either pallet is over its stacking weight limit or
// the pair is over the forklift clearance height; height-overflow when the pair
// is taller than the container interior.
export function stackWarnings(p: PlacedPallet): StackWarning[] {
  const top = p.stackedPallet;
  if (!top) return [];
  const bottom = p.pallet;
  const label = `Stack [${footprintLabel(p)}]`;
  const out: StackWarning[] = [];
  const pairKg = bottom.totalGrossKg + top.totalGrossKg;
  if (Math.round(pairKg - MAX_STACKED_PAIR_KG) > 0) {
    out.push({
      kind: 'overload',
      message: `${label}: ${fmt(pairKg)} kg loaded, limit ${fmt(MAX_STACKED_PAIR_KG)} kg — overloaded by ${fmt(pairKg - MAX_STACKED_PAIR_KG)} kg`,
    });
  }
  for (const pallet of [bottom, top]) {
    if (Math.round(pallet.totalGrossKg - MAX_STACKABLE_PALLET_KG) > 0) {
      out.push({
        kind: 'overload',
        message: `${label}: ${pallet.palletId} is ${fmt(pallet.totalGrossKg)} kg, limit ${fmt(MAX_STACKABLE_PALLET_KG)} kg for a stacked pallet — overloaded by ${fmt(pallet.totalGrossKg - MAX_STACKABLE_PALLET_KG)} kg`,
      });
    }
  }
  const heightMm = bottom.heightMm + top.heightMm;
  if (heightMm > CONTAINER_INNER_HEIGHT_MM) {
    out.push({
      kind: 'height-overflow',
      message: `${label}: stacked height ${fmt(heightMm)} mm — overflows container by ${fmt(heightMm - CONTAINER_INNER_HEIGHT_MM)} mm`,
    });
  } else if (heightMm > MAX_STACKED_HEIGHT_MM) {
    out.push({
      kind: 'overload',
      message: `${label}: stacked height ${fmt(heightMm)} mm — over the ${fmt(MAX_STACKED_HEIGHT_MM)} mm forklift clearance limit by ${fmt(heightMm - MAX_STACKED_HEIGHT_MM)} mm`,
    });
  }
  return out;
}

// Stack warnings are written into a result's warnings list (summary card, saved
// record); this marks them so they can be replaced when the layout changes
const STACK_WARNING_RE = /^Stack \[/;

// Which kind of stack warning a result warning is, or null for any other warning
export function stackWarningKind(message: string): StackWarning['kind'] | null {
  if (!STACK_WARNING_RE.test(message)) return null;
  return /overflows container/.test(message) ? 'height-overflow' : 'overload';
}

// The result's warnings with the stack warnings for this floor in place of any
// earlier ones
export function withStackWarnings(warnings: string[], placed: PlacedPallet[]): string[] {
  return [
    ...warnings.filter(w => !STACK_WARNING_RE.test(w)),
    ...placed.flatMap(p => stackWarnings(p).map(w => w.message)),
  ];
}

// Footprint label: "SK-03", or "SK-03 + SK-07" for a stacked pair
export function footprintLabel(p: PlacedPallet): string {
  return p.stackedPallet ? `${p.pallet.palletId} + ${p.stackedPallet.palletId}` : p.pallet.palletId;
}

// Problems with a layout: footprints overlapping, footprints off the floor,
// stacks over a weight or height limit, and pallets over the preset's weight cap
export function validateLayout(
  placed: PlacedPallet[],
  containerLength: number,
  maxPalletGrossKg: number,
  // Hand-set positions: a pallet unstacked with no free space (unstacked) only warns
  positions?: PalletPositions,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (!overlaps(a, b)) continue;
      // Stackable if either one may be dropped onto the other; when neither may,
      // the reason given is for dropping onto the pallet rather than the box
      const whyAB = stackRefusal(a, b);
      const whyBA = stackRefusal(b, a);
      const why = whyAB && whyBA ? (b.pallet.kind === 'marketing' ? whyBA : whyAB) : null;
      const box = [a, b].find(p => p.pallet.kind === 'marketing');
      const howTo = box
        ? ` They can be stacked: drag ${box.pallet.palletId} fully onto ${(box === a ? b : a).pallet.palletId}.`
        : ` They can be stacked: drag one fully onto the other.`;
      issues.push({
        kind: 'overlap',
        severity: 'error',
        palletIds: [a.pallet.palletId, b.pallet.palletId],
        message: `[${footprintLabel(a)}] overlaps [${footprintLabel(b)}]. Pallets cannot occupy the same floor space.` +
          (why ? ` Can't stack: ${why}.` : howTo),
      });
    }
  }
  for (const p of placed) {
    const out = Math.round(outsideByMm(p, containerLength));
    if (out > 0) {
      // Taken off a stack with no free space: a warning to verify, not a block
      const unstacked = positions?.[p.pallet.palletId]?.unstacked === true;
      issues.push({
        kind: 'outside',
        severity: unstacked ? 'warning' : 'error',
        palletIds: [p.pallet.palletId],
        message: unstacked
          ? `[${footprintLabel(p)}] Unstacking this pair means the load may not fit — verify with Mahendra. ` +
            `No free floor space was left; it is placed ${out.toLocaleString('en-US')}mm past the container floor.`
          : `[${footprintLabel(p)}] extends ${out.toLocaleString('en-US')}mm outside the container floor.`,
      });
    }
  }
  for (const p of placed) {
    for (const w of stackWarnings(p)) {
      issues.push({ kind: w.kind, severity: 'warning', palletIds: [p.pallet.palletId], message: w.message });
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

// The pallets with their stack fields (isStacked, stackedWith, stackPosition)
// matching the floor as laid out, so hand-made stacks show in the pallet table
// and are saved. Pallets not on this floor (other containers) are unchanged.
export function withStackFields(pallets: PalletPlan[], placed: PlacedPallet[]): PalletPlan[] {
  const onFloor = new Map<string, { stackedWith?: string; stackPosition?: 'bottom' | 'top' }>();
  for (const p of placed) {
    const top = p.stackedPallet;
    onFloor.set(p.pallet.palletId, top ? { stackedWith: top.palletId, stackPosition: 'bottom' } : {});
    if (top) onFloor.set(top.palletId, { stackedWith: p.pallet.palletId, stackPosition: 'top' });
  }
  return pallets.map(pallet => {
    const stack = onFloor.get(pallet.palletId);
    if (!stack) return pallet;
    const rest: PalletPlan = { ...pallet };
    delete rest.isStacked;
    delete rest.stackedWith;
    delete rest.stackPosition;
    return stack.stackPosition
      ? { ...rest, isStacked: true, stackedWith: stack.stackedWith, stackPosition: stack.stackPosition }
      : rest;
  });
}
