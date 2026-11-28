'use client';

import { KeyboardEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { PalletPlan, PalletPositions, ShipmentResult } from '@/lib/types';
import {
  applyPositions, CONTAINER_INNER_WIDTH_MM, CONTAINERS, floorLayout, footprintLabel, footprintLength, footprintWidth,
  findFreeSpot, LayoutIssue, overlaps, PlacedPallet, sideLanes, stackOrder, stackRefusal, StackWarning, stackWarnings, topBoxRect, validateLayout,
} from '@/lib/engine/floorPlan';
import { familyColorMap, MARKETING_COLOR } from '@/lib/familyColors';

interface Props {
  pallets: PalletPlan[];
  recommendation: ShipmentResult['containerRecommendation'];
  // Positions computed by the engine (result.placed). Results saved before
  // positions were stored have none, so they are packed here instead.
  placed?: PlacedPallet[];
  // Editor mode: footprints can be dragged when onPositionsChange is given.
  // positions are hand-set floor positions keyed by the footprint's floor pallet.
  positions?: PalletPositions;
  onPositionsChange?: (positions: PalletPositions) => void;
  // Preset's pallet weight cap, for the weight warnings in the editor
  maxPalletGrossKg?: number;
}

// Side view scale (px per mm)
const SCALE = 0.052;
// Side view: px shift per lane further from the viewer
const LANE_DX = 10;
const LANE_DY = 10;
const C_WIDTH_MM = CONTAINER_INNER_WIDTH_MM;

// Top view: the container floor fits this many px across
const TOP_VIEW_PX = 600;
// Drag positions are kept to this grid, and land flush on a wall or another
// footprint's edge when within the snap distance
const GRID_MM = 10;
const SNAP_MM = 60;
// Arrow keys move the selected footprint this far (Shift: ×10)
const KEY_STEP_MM = 10;
// A press that moves less than this is a click (select), not a drag
const CLICK_MAX_MOVE_PX = 4;
const TOAST_MS = 5000;
const ERROR_COLOR = '#dc2626';
// Stack warnings: orange for a weight / clearance overload, red for a stack
// taller than the container (both warn; neither blocks Save)
const OVERLOAD_COLOR = '#ea580c';
const HEIGHT_OVERFLOW_COLOR = '#dc2626';

function px(mm: number) { return Math.round(mm * SCALE); }

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Height of a footprint from the floor: both pallets when stacked
function stackHeight(p: PlacedPallet) {
  return p.pallet.heightMm + (p.stackedPallet?.heightMm ?? 0);
}

// The candidate nearest to value, if within SNAP_MM; otherwise value on the grid
function snap(value: number, candidates: number[]): number {
  let best = Math.round(value / GRID_MM) * GRID_MM;
  let bestGap = SNAP_MM;
  for (const c of candidates) {
    const gap = Math.abs(value - c);
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

interface Drag {
  id: string;            // floor pallet of the footprint
  pointerId: number;
  offsetX: number;       // pointer position minus footprint corner, mm
  offsetY: number;
  startClientX: number;
  startClientY: number;
  x: number;             // footprint position while dragging, mm
  y: number;
  moved: boolean;
}

interface Toast {
  id: number;
  message: string;
  tone: 'error' | 'warning' | 'info';
}

export default function ContainerFloorPlan({
  pallets, recommendation, placed: savedPlaced, positions, onPositionsChange, maxPalletGrossKg,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'top' | 'side'>('top');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const toastId = useRef(0);
  const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => toastTimers.current.forEach(clearTimeout), []);

  const editable = !!onPositionsChange;
  const layout = floorLayout(pallets, recommendation, savedPlaced);
  const containerLength = layout?.containerLength ?? 0;

  // Footprints where they stand now: hand-set positions over the engine's
  const placed = useMemo(
    () => (layout ? applyPositions(layout.placed, positions, layout.containerLength) : []),
    // layout is rebuilt each render; its inputs are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pallets, recommendation, savedPlaced, positions],
  );
  const issues = useMemo(
    () => (editable && layout && maxPalletGrossKg !== undefined
      ? validateLayout(placed, containerLength, maxPalletGrossKg, positions)
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editable, placed, containerLength, maxPalletGrossKg],
  );
  const flagged = useMemo(
    () => new Set(issues.filter(i => i.severity === 'error').flatMap(i => i.palletIds)),
    [issues],
  );

  if (!layout) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Container Floor Plan</h2>
        <p className="text-sm text-gray-400">Not applicable for LCL — shipment will be consolidated by the freight forwarder.</p>
      </div>
    );
  }

  const { containerKey } = layout;
  const container = CONTAINERS[containerKey];
  const isMoved = !!positions && Object.keys(positions).length > 0;

  // The footprint being dragged is drawn at the drag position until it's dropped
  const shown = drag?.moved
    ? placed.map(p => (p.pallet.palletId === drag.id ? { ...p, x: drag.x, y: drag.y } : p))
    : placed;
  const overflowCount = shown.filter(p => p.overflow).length;
  // Weight / height warnings per stacked footprint, in every mode (the PDF too)
  const stackWarns = new Map<string, StackWarning[]>(
    shown.map(p => [p.pallet.palletId, stackWarnings(p)] as [string, StackWarning[]]).filter(([, w]) => w.length > 0),
  );
  const stackedCount = shown.filter(p => p.stackedPallet).length;

  // ── Toasts ────────────────────────────────────────────────────────────────
  function showToasts(messages: string[], tone: Toast['tone'] = 'error') {
    if (messages.length === 0) return;
    const added = messages.map(message => ({ id: ++toastId.current, message, tone }));
    setToasts(prev => [...prev, ...added]);
    toastTimers.current.push(setTimeout(() => {
      setToasts(prev => prev.filter(t => !added.some(a => a.id === t.id)));
    }, TOAST_MS));
  }

  // Saves a footprint's new position and toasts any error it now takes part in.
  // Dragged so its centre lands on exactly one other single pallet (not just
  // clipping an edge, and never by an arrow-key nudge), it's a stacking intent: unless
  // a hard rule refuses it (fit, triple stack, customers), the heavier pallet becomes
  // the bottom and the pair stands where the other pallet stood. Weight and height
  // limits never block the stack; they're shown as warnings on it. Otherwise the
  // overlap error stands, with the reason the stack isn't allowed.
  function commitMove(id: string, x: number, y: number, mayStack = false) {
    if (!onPositionsChange || !layout) return;
    const next = { ...positions, [id]: { x, y } };
    const after = applyPositions(layout.placed, next, layout.containerLength);
    const moved = after.find(p => p.pallet.palletId === id);
    const hits = moved ? after.filter(o => o !== moved && overlaps(moved, o)) : [];
    const centreOn = (o: PlacedPallet) => {
      if (!moved) return false;
      const cx = moved.x + footprintLength(moved) / 2;
      const cy = moved.y + footprintWidth(moved) / 2;
      return cx > o.x && cx < o.x + footprintLength(o) && cy > o.y && cy < o.y + footprintWidth(o);
    };
    if (mayStack && moved && hits.length === 1 && centreOn(hits[0]) && !stackRefusal(moved, hits[0])) {
      const target = hits[0];
      const before = placed.find(p => p.pallet.palletId === id);
      // A marketing box always goes on top; otherwise the heavier pallet is the bottom
      const [bottom, top] = stackOrder(moved.pallet, target.pallet)[0] === moved.pallet ? [moved, target] : [target, moved];
      // The top keeps a position to return to if it's unstacked: where the
      // dragged pallet came from, or where the pallet it was dropped on stood
      const topHome = top === moved && before ? { x: before.x, y: before.y } : { x: target.x, y: target.y };
      onPositionsChange({
        ...positions,
        [bottom.pallet.palletId]: { x: target.x, y: target.y },
        [top.pallet.palletId]: { ...topHome, stackedOn: bottom.pallet.palletId },
      });
      showToasts([`${top.pallet.palletId} stacked on ${bottom.pallet.palletId}.`], 'info');
      // Weight and height limits don't block the stack; they're flagged on it
      const pair = { ...target, pallet: bottom.pallet, stackedPallet: top.pallet };
      showToasts(stackWarnings(pair).map(w => w.message), 'warning');
      return;
    }
    const errors = validateLayout(after, layout.containerLength, maxPalletGrossKg ?? Infinity, next)
      .filter(i => i.severity === 'error' && i.palletIds.includes(id));
    onPositionsChange(next);
    showToasts(errors.map(i => i.message));
  }

  // ── Dragging (plain SVG pointer events) ──────────────────────────────────
  function toMm(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const mm = pt.matrixTransform(ctm.inverse());
    return { x: mm.x, y: mm.y };
  }

  // Inside the floor, on the grid, snapped flush to walls and other footprints
  function constrain(p: PlacedPallet, rawX: number, rawY: number): { x: number; y: number } {
    const len = footprintLength(p);
    const wid = footprintWidth(p);
    const others = placed.filter(o => o.pallet.palletId !== p.pallet.palletId);
    const xs = [0, containerLength - len, ...others.flatMap(o => [o.x + footprintLength(o), o.x - len, o.x])];
    const ys = [0, C_WIDTH_MM - wid, ...others.flatMap(o => [o.y + footprintWidth(o), o.y - wid, o.y])];
    return {
      x: clamp(snap(rawX, xs), 0, Math.max(0, containerLength - len)),
      y: clamp(snap(rawY, ys), 0, Math.max(0, C_WIDTH_MM - wid)),
    };
  }

  // Takes the top pallet off a stack, whether the engine or a drag made it, and
  // puts it in the free floor space nearest the stack. If no space is free it goes
  // just past the container end, and the layout checks warn (without blocking
  // Save) that the load may not fit.
  function unstack(unit: PlacedPallet) {
    const top = unit.stackedPallet;
    if (!onPositionsChange || !layout || !top) return;
    const topId = top.palletId;
    // Split, for now standing where the stack stands
    const split = { ...positions, [topId]: { x: unit.x, y: unit.y } };
    const after = applyPositions(layout.placed, split, layout.containerLength);
    const topUnit = after.find(u => u.pallet.palletId === topId);
    const others = after.filter(u => u.pallet.palletId !== topId);
    if (!topUnit) return;
    const len = footprintLength(topUnit);
    const wid = footprintWidth(topUnit);
    const spot = findFreeSpot(others, len, wid, { x: unit.x, y: unit.y }, layout.containerLength);
    if (spot) {
      onPositionsChange({ ...positions, [topId]: spot });
      showToasts([`${topId} unstacked from ${unit.pallet.palletId} and moved to the nearest free floor space.`], 'info');
      return;
    }
    const pastEnd = Math.max(layout.containerLength, ...others.map(o => o.x + footprintLength(o)));
    onPositionsChange({ ...positions, [topId]: { x: pastEnd, y: 0, unstacked: true } });
    showToasts([`Unstacking this pair means the load may not fit — verify with Mahendra. No free floor space was left for ${topId}.`], 'warning');
  }

  function handlePointerDown(e: PointerEvent<SVGGElement>, p: PlacedPallet) {
    if (!editable || e.button !== 0) return;
    const mm = toMm(e.clientX, e.clientY);
    if (!mm) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    setDrag({
      id: p.pallet.palletId,
      pointerId: e.pointerId,
      offsetX: mm.x - p.x,
      offsetY: mm.y - p.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      x: p.x,
      y: p.y,
      moved: false,
    });
  }

  function handlePointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const moved = drag.moved ||
      Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) >= CLICK_MAX_MOVE_PX;
    if (!moved) return;
    const mm = toMm(e.clientX, e.clientY);
    const p = placed.find(q => q.pallet.palletId === drag.id);
    if (!mm || !p) return;
    setDrag({ ...drag, ...constrain(p, mm.x - drag.offsetX, mm.y - drag.offsetY), moved: true });
  }

  function handlePointerUp(e: PointerEvent<SVGSVGElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    svgRef.current?.releasePointerCapture(e.pointerId);
    const p = placed.find(q => q.pallet.palletId === drag.id);
    if (drag.moved && p && (drag.x !== p.x || drag.y !== p.y)) {
      commitMove(drag.id, drag.x, drag.y, true);
    } else if (!drag.moved) {
      setSelected(selected === drag.id ? null : drag.id);
    }
    setDrag(null);
  }

  function handleKeyDown(e: KeyboardEvent<SVGGElement>, p: PlacedPallet) {
    const step = e.shiftKey ? KEY_STEP_MM * 10 : KEY_STEP_MM;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected(selected === p.pallet.palletId ? null : p.pallet.palletId);
      return;
    }
    const d = delta[e.key];
    if (!editable || !d) return;
    e.preventDefault();
    const len = footprintLength(p);
    const x = clamp(p.x + d[0], 0, Math.max(0, containerLength - len));
    const y = clamp(p.y + d[1], 0, Math.max(0, C_WIDTH_MM - footprintWidth(p)));
    if (x !== p.x || y !== p.y) commitMove(p.pallet.palletId, x, y);
  }

  // ── Top view geometry (SVG units are mm) ─────────────────────────────────
  // Footprints off the floor (older results) stay visible beyond the container outline
  const minX = Math.min(0, ...shown.map(p => p.x));
  const maxX = Math.max(containerLength, ...shown.map(p => p.x + footprintLength(p)));
  const minY = Math.min(0, ...shown.map(p => p.y));
  const maxY = Math.max(C_WIDTH_MM, ...shown.map(p => p.y + footprintWidth(p)));
  const topScale = TOP_VIEW_PX / (maxX - minX); // px per mm
  const topHeightPx = Math.round((maxY - minY) * topScale);
  const pxToMm = (n: number) => n / topScale;

  // ── Side view ────────────────────────────────────────────────────────────
  const cL = px(container.LENGTH);
  const cH = px(container.HEIGHT);

  // Footprints whose lengths overlap sit in lanes across the width. Lane 0 is
  // nearest the viewer (the left wall, y = 0); each lane further back is drawn
  // shifted up and right so its top and right edges stay visible.
  const laneOf = sideLanes(shown);
  const maxLane = Math.max(0, ...Array.from(laneOf.values()));
  // Headroom above the outline for a stack taller than the container
  const sideOverflowPx = px(Math.max(0, ...shown.map(stackHeight)) - container.HEIGHT);
  const sidePadTop = maxLane * LANE_DY + Math.max(0, sideOverflowPx);
  const sidePadRight = maxLane * LANE_DX;

  const familyColors = familyColorMap(pallets);

  // Every rectangle in the side view, in paint order: far lanes first, then
  // tallest first within a lane. A stack gives two rectangles (bottom on the
  // floor, top on the bottom one).
  const sideShapes = [...shown]
    .sort((a, b) => (laneOf.get(b) ?? 0) - (laneOf.get(a) ?? 0) || stackHeight(b) - stackHeight(a))
    .flatMap(placedPallet => {
      const { pallet, stackedPallet, x, overflow, rotated } = placedPallet;
      const lane = laneOf.get(placedPallet) ?? 0;
      const warns = stackWarns.get(pallet.palletId) ?? [];
      // Top pallet of a flagged stack: red when it sticks out, orange when overloaded
      const topColor = warns.some(w => w.kind === 'height-overflow') ? HEIGHT_OVERFLOW_COLOR
        : warns.length > 0 ? OVERLOAD_COLOR : null;
      const layers = [{ p: pallet, baseMm: 0, isTop: false }];
      if (stackedPallet) layers.push({ p: stackedPallet, baseMm: pallet.heightMm, isTop: true });

      return layers.map(({ p, baseMm, isTop }) => {
        const alongMm = rotated ? p.widthMm : p.lengthMm;
        // A marketing box on top sits centred along its pallet
        const centreMm = isTop && p.kind === 'marketing' ? (footprintLength(placedPallet) - alongMm) / 2 : 0;
        const floorX = px(Math.max(0, Math.min(x + centreMm, container.LENGTH - 10)));
        const w = overflow ? Math.max(4, Math.min(px(alongMm), cL - floorX)) : px(alongMm);
        const h = px(p.heightMm);
        return {
          id: p.palletId,
          // Lanes further back shift up and right so their top/right edges show
          x: floorX + lane * LANE_DX,
          y: sidePadTop + cH - px(baseMm) - h - lane * LANE_DY, // floor at bottom
          w,
          h,
          isTop,
          color: overflow ? '#ef4444' : (isTop && topColor) || (familyColors[p.family] ?? '#94a3b8'),
          isSel: selected === p.palletId,
          showLabel: !overflow && w > 24 && h > 14,
        };
      });
    });

  const selectedPallet = selected ? pallets.find(p => p.palletId === selected) : null;
  // The selected pallet's stack, as the floor stands now
  const selectedUnit = selected
    ? placed.find(u => u.pallet.palletId === selected || u.stackedPallet?.palletId === selected)
    : undefined;
  const selectedIsTop = selectedUnit?.stackedPallet?.palletId === selected;
  const selectedPartner = selectedUnit?.stackedPallet
    ? (selectedIsTop ? selectedUnit.pallet : selectedUnit.stackedPallet)
    : undefined;
  // Whether the selected stack was made by hand (by a drag) or by the engine
  const handStackTop = selectedUnit?.stackedPallet && positions?.[selectedUnit.stackedPallet.palletId]?.stackedOn
    ? selectedUnit.stackedPallet.palletId
    : null;
  const selectedStack = editable && selectedUnit?.stackedPallet ? selectedUnit : null;
  // Only what this container holds: a split shipment draws its first container
  const totalCBM = placed.reduce((s, p) => s + p.pallet.cbm + (p.stackedPallet?.cbm ?? 0), 0);
  const maxCBM = container.LENGTH * C_WIDTH_MM * container.HEIGHT / 1e9;
  const utilPct = Math.min(100, (totalCBM / maxCBM) * 100);
  const errorCount = issues.filter(i => i.severity === 'error').length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Container Floor Plan</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {containerKey === 'FCL_20FT' ? '20ft' : '40ft'} · {container.LENGTH/1000}m × {C_WIDTH_MM/1000}m × {container.HEIGHT/1000}m
            {recommendation === 'MULTI_CONTAINER' && (
              <span className="ml-2 text-amber-600 font-medium">· Showing container 1 of split shipment</span>
            )}
            {isMoved && <span className="ml-2 text-blue-700 font-medium">· Layout adjusted by hand</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {stackedCount > 0 && (
            <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1">
              ⬆ {stackedCount} pallet{stackedCount > 1 ? 's' : ''} stacked
            </span>
          )}
          {overflowCount > 0 && (
            <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1">
              ⚠ {overflowCount} pallet{overflowCount > 1 ? 's' : ''} overflow
            </span>
          )}
          <div data-pdf-hide className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {(['top', 'side'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 transition-colors ${view === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {v === 'top' ? '⬆ Top' : '➡ Side'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(familyColors).map(([fam, color]) => (
          <span key={fam} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: color, opacity: 0.8 }} />
            {fam}
          </span>
        ))}
        {overflowCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-red-600">
            <span className="w-3 h-3 rounded-sm inline-block bg-red-400 opacity-80" />
            Overflow
          </span>
        )}
      </div>

      {/* Editor instructions and reset, above the drawing */}
      {editable && (
        <div data-pdf-hide className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5">
          <div>
            <p className="text-sm font-semibold text-blue-900">Drag pallets to reposition · Errors shown below</p>
            <p className="text-xs text-blue-700 mt-0.5">
              {view === 'top'
                ? 'Drop a pallet onto another to stack it (if the stacking limits allow); click a stack to unstack it. Click to select; arrow keys nudge 10 mm (Shift: 100 mm).'
                : 'Switch to the Top view to move pallets.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedStack && (
              <button
                onClick={() => unstack(selectedStack)}
                className="text-sm font-semibold text-blue-700 bg-white border border-blue-300 hover:bg-blue-100 rounded-lg px-4 py-2 transition-colors"
              >
                ⇵ Unstack {footprintLabel(selectedStack)}
              </button>
            )}
            <button
              onClick={() => onPositionsChange?.({})}
              disabled={!isMoved}
              className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed rounded-lg px-4 py-2 transition-colors"
            >
              ↺ Reset to auto layout
            </button>
          </div>
        </div>
      )}

      {/* SVG */}
      <div className="overflow-x-auto">
        {view === 'top' ? (
          <svg
            ref={svgRef}
            width={TOP_VIEW_PX}
            height={topHeightPx}
            viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => setDrag(null)}
            role="img"
            aria-label={`Container floor plan, top view, ${shown.length} pallet positions`}
            // Shrinks to fit a half-width panel; drags map through getScreenCTM so scaling is safe
            style={{ display: 'block', userSelect: 'none', maxWidth: '100%', height: 'auto' }}
          >
            {/* Container floor */}
            <rect
              x={0} y={0} width={containerLength} height={C_WIDTH_MM}
              fill="#f8faff" stroke="#1e40af" strokeWidth={2} vectorEffect="non-scaling-stroke"
            />
            {shown.map(p => {
              const { pallet, stackedPallet, x, y, overflow } = p;
              const id = pallet.palletId;
              const len = footprintLength(p);
              const wid = footprintWidth(p);
              const wPx = len * topScale;
              const hPx = wid * topScale;
              const color = overflow ? '#ef4444' : (familyColors[pallet.family] ?? '#94a3b8');
              const isSel = selected === id || (!!stackedPallet && selected === stackedPallet.palletId);
              const isDragging = drag?.moved && drag.id === id;
              const hasError = flagged.has(id);
              const warns = stackWarns.get(id);
              const topBox = topBoxRect(p);
              // Red when the stack sticks out of the container, else orange
              const warnColor = warns?.some(w => w.kind === 'height-overflow') ? HEIGHT_OVERFLOW_COLOR : OVERLOAD_COLOR;
              const label = footprintLabel(p);
              const grossKg = pallet.totalGrossKg + (stackedPallet?.totalGrossKg ?? 0);
              const weightLabel = `${Math.round(grossKg).toLocaleString('en-US')} kg`;
              // Label font: at most 11px, shrunk to fit the footprint's length
              const fontPx = Math.min(11, (wPx - 6) / (label.length * 0.62));
              const showLabel = fontPx >= 6 && hPx > 12;
              const showWeight = showLabel && hPx > 28;
              const inset = pxToMm(1);

              return (
                <g
                  key={id}
                  onPointerDown={e => handlePointerDown(e, p)}
                  onClick={editable ? undefined : () => setSelected(isSel ? null : id)}
                  onKeyDown={e => handleKeyDown(e, p)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${label}, ${weightLabel}, ${Math.round(x)} mm from the front, ${Math.round(y)} mm from the left wall${hasError ? ', has a placement error' : ''}${warns ? `, ${warns.length} stack warning${warns.length > 1 ? 's' : ''}` : ''}`}
                  aria-pressed={isSel}
                  // touch-action must be set before the touch starts, or the browser scrolls instead
                  style={{
                    cursor: editable ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
                    outline: 'none',
                    touchAction: editable ? 'none' : undefined,
                  }}
                  className="focus-visible:[&>rect:first-child]:stroke-blue-900"
                >
                  <rect
                    x={x + inset} y={y + inset} width={Math.max(inset, len - 2 * inset)} height={Math.max(inset, wid - 2 * inset)}
                    fill={color}
                    fillOpacity={isDragging ? 0.75 : isSel ? 0.9 : 0.6}
                    stroke={hasError ? ERROR_COLOR : isSel ? '#1e40af' : color}
                    strokeWidth={hasError ? 3 : isSel ? 2.5 : 1}
                    vectorEffect="non-scaling-stroke"
                    rx={pxToMm(2)}
                  />
                  {/* Marketing box stacked on this pallet: drawn where it sits, centred on it */}
                  {topBox && (
                    <rect
                      x={topBox.x} y={topBox.y} width={topBox.len} height={topBox.wid}
                      fill={MARKETING_COLOR} fillOpacity={0.85}
                      stroke="white" strokeWidth={1.5} strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke" rx={pxToMm(1)}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {/* Marketing material: dashed inner border marks a loose box, not a pallet */}
                  {pallet.kind === 'marketing' && wPx > 10 && hPx > 10 && (
                    <rect
                      x={x + pxToMm(3)} y={y + pxToMm(3)} width={len - pxToMm(6)} height={wid - pxToMm(6)}
                      fill="none" stroke="white" strokeWidth={1.5} strokeDasharray="4 3" strokeOpacity={0.9}
                      vectorEffect="non-scaling-stroke" rx={pxToMm(1)}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {/* Stacked: inner border marks two pallets on this footprint */}
                  {stackedPallet && wPx > 10 && hPx > 10 && (
                    <rect
                      x={x + pxToMm(4)} y={y + pxToMm(4)} width={len - pxToMm(8)} height={wid - pxToMm(8)}
                      fill="none" stroke="white" strokeWidth={1.5} strokeOpacity={0.9}
                      vectorEffect="non-scaling-stroke" rx={pxToMm(1)}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {showLabel && (
                    <text
                      x={x + len / 2}
                      y={y + wid / 2 - (showWeight ? pxToMm(fontPx * 0.6) : 0)}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={pxToMm(fontPx)}
                      fill="white" fontWeight="600"
                      style={{ pointerEvents: 'none' }}
                    >
                      {label}
                    </text>
                  )}
                  {showWeight && (
                    <text
                      x={x + len / 2}
                      y={y + wid / 2 + pxToMm(fontPx * 0.75)}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={pxToMm(Math.min(fontPx, 9.5))}
                      fill="white" fillOpacity={0.92}
                      style={{ pointerEvents: 'none' }}
                    >
                      {weightLabel}
                    </text>
                  )}
                  {warns && wPx > 14 && hPx > 14 && (
                    // Hover shows the messages; a press still drags the footprint
                    <g>
                      <title>{warns.map(w => w.message).join('\n')}</title>
                      <circle
                        cx={x + pxToMm(9)} cy={y + pxToMm(9)} r={pxToMm(7)}
                        fill={warnColor} stroke="white" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                      />
                      <text
                        x={x + pxToMm(9)} y={y + pxToMm(9.5)}
                        textAnchor="middle" dominantBaseline="middle"
                        fontSize={pxToMm(9)} fill="white" fontWeight="700"
                      >
                        !
                      </text>
                    </g>
                  )}
                  {stackedPallet && wPx > 56 && hPx > 16 && (
                    <text
                      x={x + len - pxToMm(8)} y={y + pxToMm(10)}
                      textAnchor="end" dominantBaseline="middle"
                      fontSize={pxToMm(8)} fill="white" fontWeight="700"
                      style={{ pointerEvents: 'none' }}
                    >
                      ↑ stacked
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        ) : (
          // SIDE VIEW — every pallet solid at its x position (along the length) and height.
          // A stacked pair is drawn as two rectangles: bottom from the floor, top on it.
          // Side-by-side pallets are offset by lane (slight 3-D shift) so none is hidden.
          <svg width={cL + 2 + sidePadRight} height={cH + 2 + sidePadTop} style={{ display: 'block' }}>
            {/* Real container outline; lane offsets may overhang it slightly */}
            <rect
              x={1} y={sidePadTop + 1} width={cL} height={cH}
              fill="#f8faff" stroke="#1e40af" strokeWidth={2} rx={4}
            />
            {/* Pallet rectangles, far lanes first so nearer ones paint over them */}
            {sideShapes.map(s => (
              <g key={s.id} onClick={() => setSelected(s.isSel ? null : s.id)} style={{ cursor: 'pointer' }}>
                <rect
                  x={s.x + 1} y={s.y + 1} width={s.w - 2} height={s.h - 2}
                  fill={s.color}
                  // Top pallet of a stack: lighter shade of the same colour
                  fillOpacity={s.isSel ? 0.9 : s.isTop ? 0.35 : 0.6}
                  stroke={s.isSel ? '#1e40af' : s.color}
                  strokeWidth={s.isSel ? 2.5 : 1}
                  rx={2}
                />
              </g>
            ))}
            {/* Labels in a final pass so no pallet in a nearer lane can cover them;
                each sits in its own pallet's top strip. A label may overlap a nearer
                pallet's body, so clicking it selects the pallet it names. */}
            {sideShapes.filter(s => s.showLabel).map(s => (
              <text
                key={`label-${s.id}`}
                x={s.x + s.w / 2} y={s.y + LANE_DY / 2 + 1}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={Math.min(9, s.h / 2.2)}
                fill="white" fontWeight="600"
                stroke="rgba(15, 23, 42, 0.35)" strokeWidth={2} paintOrder="stroke"
                onClick={() => setSelected(s.isSel ? null : s.id)}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                {s.id}
              </text>
            ))}
          </svg>
        )}
      </div>

      {/* Selected pallet detail */}
      {selectedPallet && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-900 space-y-1">
          <div className="font-semibold">
            {selectedPallet.palletId} — {selectedPallet.isMixedSku
              ? (selectedPallet.productCodes ?? []).join(', ')
              : selectedPallet.productCode}
          </div>
          <div className="flex flex-wrap gap-4 text-blue-700">
            <span>L {selectedPallet.lengthMm.toLocaleString()} mm</span>
            <span>W {selectedPallet.widthMm} mm</span>
            <span>H {selectedPallet.heightMm} mm</span>
            <span>{selectedPallet.cbm} CBM</span>
            <span>{selectedPallet.totalGrossKg} kg gross</span>
          </div>
          {selectedPartner && (
            <div className="text-blue-700 flex items-center gap-3 flex-wrap">
              <span>
                ⧉ Stacked {selectedIsTop ? 'on top of' : 'under'} {selectedPartner.palletId}
                {handStackTop && ' (by hand)'}
                {' · '}combined H {selectedPallet.heightMm + selectedPartner.heightMm} mm
                {' · '}{selectedPallet.totalGrossKg + selectedPartner.totalGrossKg} kg gross
              </span>
              {selectedStack && (
                <button
                  data-pdf-hide
                  onClick={() => unstack(selectedStack)}
                  className="font-semibold text-blue-700 border border-blue-300 hover:bg-blue-100 rounded px-2 py-0.5"
                >
                  Unstack
                </button>
              )}
            </div>
          )}
          {selectedPallet.isMixedSku && selectedPallet.skuBreakdown && (
            <div className="text-blue-600">
              {selectedPallet.skuBreakdown.map(s => `${s.productCode} ×${s.quantity}`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {/* Layout checks: the persistent list (toasts only flag the latest move) */}
      {editable && <LayoutIssueList issues={issues} errorCount={errorCount} />}
      {/* Read-only (history, share link, PDF): the stack warnings alone */}
      {!editable && stackWarns.size > 0 && (
        <ul className="space-y-1">
          {Array.from(stackWarns.values()).flat().map((w, i) => (
            <li key={i} className={`text-xs rounded-lg border px-3 py-1.5 ${ISSUE_STYLE[w.kind].className}`}>
              <span className="font-semibold uppercase mr-2">⚠ {ISSUE_STYLE[w.kind].tag}</span>
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {/* Utilisation */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Volume utilisation</span>
          <span>{totalCBM.toFixed(2)} / {maxCBM.toFixed(1)} CBM ({utilPct.toFixed(0)}%)</span>
        </div>
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-2 rounded-full transition-all"
            style={{
              width: `${utilPct}%`,
              background: utilPct > 95 ? '#ef4444' : 'linear-gradient(90deg, #3b82f6, #1e40af)'
            }}
          />
        </div>
      </div>

      {/* Toasts: immediate feedback on the move just made */}
      {toasts.length > 0 && (
        <div data-pdf-hide className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm" role="status" aria-live="polite">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`flex items-start gap-3 rounded-lg border bg-white shadow-lg px-4 py-3 text-sm ${
                t.tone === 'error' ? 'border-red-200 text-red-700'
                  : t.tone === 'warning' ? 'border-amber-200 text-amber-800'
                    : 'border-green-200 text-green-800'
              }`}
            >
              <span aria-hidden>{t.tone === 'info' ? '↑' : '⚠'}</span>
              <span className="flex-1">{t.message}</span>
              <button
                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                aria-label="Dismiss"
                className={t.tone === 'error' ? 'text-red-400 hover:text-red-700' : t.tone === 'warning' ? 'text-amber-500 hover:text-amber-800' : 'text-green-500 hover:text-green-800'}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Errors: solid red, tagged ERROR. Stack warnings: orange (overload) or a dashed
// red outline (height overflow), tagged by what they are, so neither reads as an error.
const ISSUE_STYLE: Record<StackWarning['kind'], { tag: string; className: string }> = {
  'overload': { tag: 'Overload', className: 'bg-orange-50 border-orange-300 text-orange-800' },
  'height-overflow': { tag: 'Height overflow', className: 'bg-white border-dashed border-red-400 text-red-700' },
};

function issueStyle(issue: LayoutIssue): { tag: string; className: string } {
  if (issue.severity === 'error') return { tag: 'Error', className: 'bg-red-50 border-red-200 text-red-700' };
  if (issue.kind === 'overload' || issue.kind === 'height-overflow') return ISSUE_STYLE[issue.kind];
  return { tag: 'Warning', className: 'bg-amber-50 border-amber-200 text-amber-800' };
}

function LayoutIssueList({ issues, errorCount }: { issues: LayoutIssue[]; errorCount: number }) {
  if (issues.length === 0) {
    return (
      <p data-pdf-hide className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        ✓ Layout checks passed — no overlaps, every pallet on the floor, all within the weight and height limits.
      </p>
    );
  }
  const warningCount = issues.length - errorCount;
  return (
    <div data-pdf-hide className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-700">
        Layout checks
        {errorCount > 0 && <span className="ml-2 text-red-700">{errorCount} error{errorCount > 1 ? 's' : ''}</span>}
        {warningCount > 0 && <span className="ml-2 text-amber-700">{warningCount} warning{warningCount > 1 ? 's' : ''}</span>}
      </p>
      <ul className="space-y-1">
        {issues.map((issue, i) => (
          <li key={i} className={`text-xs rounded-lg border px-3 py-1.5 ${issueStyle(issue).className}`}>
            <span className="font-semibold uppercase mr-2">{issueStyle(issue).tag}</span>
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
