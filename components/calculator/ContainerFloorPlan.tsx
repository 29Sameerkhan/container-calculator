'use client';

import { KeyboardEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { PalletPlan, PalletPositions, ShipmentResult } from '@/lib/types';
import {
  applyPositions, CONTAINER_INNER_WIDTH_MM, CONTAINERS, floorLayout, footprintLabel, footprintLength, footprintWidth,
  LayoutIssue, PlacedPallet, sideLanes, validateLayout,
} from '@/lib/engine/floorPlan';
import { familyColorMap } from '@/lib/familyColors';

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
      ? validateLayout(placed, containerLength, maxPalletGrossKg)
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
  const stackedCount = shown.filter(p => p.stackedPallet).length;

  // ── Toasts ────────────────────────────────────────────────────────────────
  function showToasts(messages: string[]) {
    if (messages.length === 0) return;
    const added = messages.map(message => ({ id: ++toastId.current, message }));
    setToasts(prev => [...prev, ...added]);
    toastTimers.current.push(setTimeout(() => {
      setToasts(prev => prev.filter(t => !added.some(a => a.id === t.id)));
    }, TOAST_MS));
  }

  // Saves a footprint's new position and toasts any error it now takes part in
  function commitMove(id: string, x: number, y: number) {
    if (!onPositionsChange || !layout) return;
    const next = { ...positions, [id]: { x, y } };
    const after = applyPositions(layout.placed, next, layout.containerLength);
    const errors = validateLayout(after, layout.containerLength, maxPalletGrossKg ?? Infinity)
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
      commitMove(drag.id, drag.x, drag.y);
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
  const sidePadTop = maxLane * LANE_DY;
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
      const layers = [{ p: pallet, baseMm: 0, isTop: false }];
      if (stackedPallet) layers.push({ p: stackedPallet, baseMm: pallet.heightMm, isTop: true });

      return layers.map(({ p, baseMm, isTop }) => {
        const floorX = px(Math.max(0, Math.min(x, container.LENGTH - 10)));
        const alongMm = rotated ? p.widthMm : p.lengthMm;
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
          color: overflow ? '#ef4444' : (familyColors[p.family] ?? '#94a3b8'),
          isSel: selected === p.palletId,
          showLabel: !overflow && w > 24 && h > 14,
        };
      });
    });

  const selectedPallet = selected ? pallets.find(p => p.palletId === selected) : null;
  const selectedPartner = selectedPallet?.stackedWith
    ? pallets.find(p => p.palletId === selectedPallet.stackedWith)
    : undefined;
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
                ? 'Click a pallet to select it; arrow keys nudge it 10 mm (Shift: 100 mm).'
                : 'Switch to the Top view to move pallets.'}
            </p>
          </div>
          <button
            onClick={() => onPositionsChange?.({})}
            disabled={!isMoved}
            className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed rounded-lg px-4 py-2 transition-colors"
          >
            ↺ Reset to auto layout
          </button>
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
            style={{ display: 'block', userSelect: 'none' }}
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
                  aria-label={`${label}, ${weightLabel}, ${Math.round(x)} mm from the front, ${Math.round(y)} mm from the left wall${hasError ? ', has a placement error' : ''}`}
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
                  {stackedPallet && wPx > 40 && hPx > 16 && (
                    <text
                      x={x + len - pxToMm(8)} y={y + pxToMm(10)}
                      textAnchor="end" dominantBaseline="middle"
                      fontSize={pxToMm(8)} fill="white" fontWeight="700"
                      style={{ pointerEvents: 'none' }}
                    >
                      ⬆2
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
          {selectedPallet.isStacked && selectedPartner && (
            <div className="text-blue-700">
              ⧉ Stacked {selectedPallet.stackPosition === 'top' ? 'on top of' : 'under'} {selectedPartner.palletId}
              {' · '}combined H {selectedPallet.heightMm + selectedPartner.heightMm} mm
              {' · '}{selectedPallet.totalGrossKg + selectedPartner.totalGrossKg} kg gross
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
              className="flex items-start gap-3 rounded-lg border border-red-200 bg-white shadow-lg px-4 py-3 text-sm text-red-700"
            >
              <span aria-hidden>⚠</span>
              <span className="flex-1">{t.message}</span>
              <button
                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                aria-label="Dismiss"
                className="text-red-400 hover:text-red-700"
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

function LayoutIssueList({ issues, errorCount }: { issues: LayoutIssue[]; errorCount: number }) {
  if (issues.length === 0) {
    return (
      <p data-pdf-hide className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        ✓ Layout checks passed — no overlaps, every pallet on the floor, all within the weight limit.
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
          <li
            key={i}
            className={`text-xs rounded-lg border px-3 py-1.5 ${
              issue.severity === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            <span className="font-semibold uppercase mr-2">{issue.severity}</span>
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
