'use client';

import { PalletPlan, ShipmentResult } from '@/lib/types';
import { packPallets, footprintLength, CONTAINERS, PlacedPallet } from '@/lib/engine/floorPlan';
import { useState } from 'react';

interface Props {
  pallets: PalletPlan[];
  recommendation: ShipmentResult['containerRecommendation'];
  // Positions computed by the engine (result.placed). Results saved before
  // positions were stored have none, so they are packed here instead.
  placed?: PlacedPallet[];
}

const SCALE = 0.052;
// Side view: px shift per lane further from the viewer
const LANE_DX = 10;
const LANE_DY = 10;
const C_WIDTH_MM = 2352;

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

function px(mm: number) { return Math.round(mm * SCALE); }

// Height of a footprint from the floor: both pallets when stacked
function stackHeight(p: PlacedPallet) {
  return p.pallet.heightMm + (p.stackedPallet?.heightMm ?? 0);
}

export default function ContainerFloorPlan({ pallets, recommendation, placed: savedPlaced }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'top' | 'side'>('top');

  if (recommendation === 'LCL') {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Container Floor Plan</h2>
        <p className="text-sm text-gray-400">Not applicable for LCL — shipment will be consolidated by the freight forwarder.</p>
      </div>
    );
  }

  const containerKey = recommendation === 'FCL_20FT' ? 'FCL_20FT' : 'FCL_40FT';
  const container = CONTAINERS[containerKey];
  const placed = savedPlaced ?? packPallets(pallets, container.LENGTH);
  const overflowCount = placed.filter(p => p.overflow).length;

  const cW = px(C_WIDTH_MM);
  const cL = px(container.LENGTH);
  const cH = px(container.HEIGHT);

  // Side view depth: pallets sharing a strip (same x) sit in lanes across the
  // width. Lane 0 is nearest the viewer (the left wall, y = 0); each lane further
  // back is drawn shifted up and right so its top and right edges stay visible.
  const laneOf = new Map<PlacedPallet, number>();
  const strips = new Map<number, PlacedPallet[]>();
  for (const p of placed) {
    if (!strips.has(p.x)) strips.set(p.x, []);
    strips.get(p.x)!.push(p);
  }
  strips.forEach(strip => {
    [...strip].sort((a, b) => a.y - b.y).forEach((p, lane) => laneOf.set(p, lane));
  });
  const maxLane = Math.max(0, ...Array.from(laneOf.values()));
  const sidePadTop = maxLane * LANE_DY;
  const sidePadRight = maxLane * LANE_DX;

  const familyColors: Record<string, string> = {};
  let colorIdx = 0;
  for (const p of pallets) {
    if (!familyColors[p.family]) {
      familyColors[p.family] = COLORS[colorIdx % COLORS.length];
      colorIdx++;
    }
  }

  // Every rectangle in the side view, in paint order: far lanes first, then
  // tallest first within a lane. A stack gives two rectangles (bottom on the
  // floor, top on the bottom one).
  const sideShapes = [...placed]
    .sort((a, b) => (laneOf.get(b) ?? 0) - (laneOf.get(a) ?? 0) || stackHeight(b) - stackHeight(a))
    .flatMap(placedPallet => {
      const { pallet, stackedPallet, x, overflow } = placedPallet;
      const lane = laneOf.get(placedPallet) ?? 0;
      const layers = [{ p: pallet, baseMm: 0, isTop: false }];
      if (stackedPallet) layers.push({ p: stackedPallet, baseMm: pallet.heightMm, isTop: true });

      return layers.map(({ p, baseMm, isTop }) => {
        const floorX = px(Math.min(x, container.LENGTH - 10));
        const w = overflow ? Math.max(4, cL - floorX) : px(p.lengthMm);
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
  const totalCBM = pallets.reduce((s, p) => s + p.cbm, 0);
  const maxCBM = container.LENGTH * C_WIDTH_MM * container.HEIGHT / 1e9;
  const utilPct = Math.min(100, (totalCBM / maxCBM) * 100);

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
          </p>
        </div>
        <div className="flex items-center gap-3">
          {overflowCount > 0 && (
            <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1">
              ⚠ {overflowCount} pallet{overflowCount > 1 ? 's' : ''} overflow
            </span>
          )}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
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

      {/* SVG */}
      <div className="overflow-x-auto">
        {view === 'top' ? (
          <svg
            width={cL + 2} height={cW + 2}
            style={{ display: 'block', border: '2px solid #1e40af', borderRadius: 4, background: '#f8faff' }}
          >
            {placed.map(p => {
              const { pallet, stackedPallet, x, y, overflow } = p;
              // Clamp overflow pallets to show just a sliver at the container edge with red stripe
              const drawX = px(Math.min(x, container.LENGTH - 10));
              const drawW = overflow ? Math.max(4, px(container.LENGTH) - drawX) : px(footprintLength(p));
              const drawY = px(y);
              const drawH = px(pallet.widthMm);
              const color = overflow ? '#ef4444' : (familyColors[pallet.family] ?? '#94a3b8');
              const isSel = selected === pallet.palletId || (!!stackedPallet && selected === stackedPallet.palletId);
              const label = stackedPallet ? `${pallet.palletId} + ${stackedPallet.palletId}` : pallet.palletId;

              return (
                <g key={pallet.palletId} onClick={() => setSelected(isSel ? null : pallet.palletId)} style={{ cursor: 'pointer' }}>
                  <rect
                    x={drawX + 1} y={drawY + 1} width={drawW - 2} height={drawH - 2}
                    fill={color}
                    fillOpacity={isSel ? 0.9 : 0.6}
                    stroke={isSel ? '#1e40af' : color}
                    strokeWidth={isSel ? 2.5 : 1}
                    rx={2}
                  />
                  {/* Stacked: inner border marks two pallets on this footprint */}
                  {stackedPallet && !overflow && drawW > 10 && drawH > 10 && (
                    <rect
                      x={drawX + 4} y={drawY + 4} width={drawW - 8} height={drawH - 8}
                      fill="none" stroke="white" strokeWidth={1.5} strokeOpacity={0.9} rx={1}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {!overflow && drawW > 24 && drawH > 12 && (
                    <text
                      x={drawX + drawW / 2} y={drawY + drawH / 2}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={Math.min(10, drawH / 2.2)}
                      fill="white" fontWeight="600"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {label}
                    </text>
                  )}
                  {stackedPallet && !overflow && drawW > 40 && drawH > 16 && (
                    <text
                      x={drawX + drawW - 8} y={drawY + 10}
                      textAnchor="end" dominantBaseline="middle"
                      fontSize={8} fill="white" fontWeight="700"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      ⬆2
                    </text>
                  )}
                </g>
              );
            })}
            {/* Container edge line */}
            <line x1={cL} y1={0} x2={cL} y2={cW} stroke="#1e40af" strokeWidth={2} />
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
    </div>
  );
}
