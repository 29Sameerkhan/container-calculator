'use client';

import { PalletPlan, ShipmentResult } from '@/lib/types';
import { packPallets, CONTAINERS } from '@/lib/engine/floorPlan';
import { useState } from 'react';

interface Props {
  pallets: PalletPlan[];
  recommendation: ShipmentResult['containerRecommendation'];
}

const SCALE = 0.052; // mm → px

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

function mmToPx(mm: number) { return Math.round(mm * SCALE); }

export default function ContainerFloorPlan({ pallets, recommendation }: Props) {
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

  // For MULTI_CONTAINER show 40ft (first container) with overflow flagged
  const containerKey = recommendation === 'FCL_20FT' ? 'FCL_20FT' : 'FCL_40FT';
  const container = CONTAINERS[containerKey];
  const placed = packPallets(pallets, container.LENGTH);

  const cW = mmToPx(container.WIDTH);
  const cL = mmToPx(container.LENGTH);
  const cH = mmToPx(container.HEIGHT);

  // Colour per family
  const familyColors: Record<string, string> = {};
  let colorIdx = 0;
  for (const p of pallets) {
    if (!familyColors[p.family]) {
      familyColors[p.family] = COLORS[colorIdx % COLORS.length];
      colorIdx++;
    }
  }

  const selectedPallet = selected ? pallets.find(p => p.palletId === selected) : null;
  const totalCBM = pallets.reduce((s, p) => s + p.cbm, 0);
  const maxCBM = container.LENGTH * container.WIDTH * container.HEIGHT / 1e9;
  const utilPct = Math.min(100, (totalCBM / maxCBM) * 100);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Container Floor Plan
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {containerKey === 'FCL_20FT' ? '20ft' : '40ft'} · {container.LENGTH/1000}m × {container.WIDTH/1000}m × {container.HEIGHT/1000}m
            {recommendation === 'MULTI_CONTAINER' && (
              <span className="ml-2 text-amber-600 font-medium">· Showing container 1 — split shipment required</span>
            )}
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
          {(['top', 'side'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 transition-colors ${view === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {v === 'top' ? '⬆ Top View' : '➡ Side View'}
            </button>
          ))}
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
      </div>

      {/* SVG */}
      <div className="overflow-x-auto">
        {view === 'top' ? (
          <svg
            width={cL + 2} height={cW + 2}
            style={{ display: 'block', border: '2px solid #1e40af', borderRadius: 4, background: '#f8faff' }}
          >
            {placed.map(({ pallet, x, y }) => {
              const px = mmToPx(x);
              const py = mmToPx(y);
              const pw = mmToPx(pallet.lengthMm);
              const ph = mmToPx(pallet.widthMm);
              const color = familyColors[pallet.family] ?? '#94a3b8';
              const isSel = selected === pallet.palletId;
              const overflows = x + pallet.lengthMm > container.LENGTH;

              return (
                <g key={pallet.palletId} onClick={() => setSelected(isSel ? null : pallet.palletId)} style={{ cursor: 'pointer' }}>
                  <rect
                    x={px + 1} y={py + 1} width={pw - 2} height={ph - 2}
                    fill={overflows ? '#ef4444' : color}
                    fillOpacity={isSel ? 0.9 : 0.55}
                    stroke={isSel ? '#1e40af' : (overflows ? '#ef4444' : color)}
                    strokeWidth={isSel ? 2 : 1}
                    rx={2}
                  />
                  {pw > 28 && ph > 14 && (
                    <text
                      x={px + pw / 2} y={py + ph / 2}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={Math.min(10, ph / 2.2)}
                      fill="white" fontWeight="600"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {pallet.palletId}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        ) : (
          // SIDE VIEW — each placed pallet drawn at its correct Y offset
          <svg
            width={cL + 2} height={cH + 2}
            style={{ display: 'block', border: '2px solid #1e40af', borderRadius: 4, background: '#f8faff' }}
          >
            {placed.map(({ pallet, x, y }) => {
              const px = mmToPx(x);
              // In side elevation, paired pallets sit side-by-side in WIDTH direction.
              // We use y offset to slightly shift overlapping pairs so both are visible.
              // (They're at same X but different Y in top view; in side view they overlap —
              // show the taller one full, offset label of the shorter one slightly.)
              const pw = mmToPx(pallet.lengthMm);
              const ph = mmToPx(pallet.heightMm);
              const svgY = cH - ph; // floor at bottom
              const color = familyColors[pallet.family] ?? '#94a3b8';
              const isSel = selected === pallet.palletId;
              // Paired pallets: offset Y>0 means this is the right-side pallet
              const isPaired = y > 0;

              return (
                <g key={pallet.palletId} onClick={() => setSelected(isSel ? null : pallet.palletId)} style={{ cursor: 'pointer' }}>
                  <rect
                    x={px + (isPaired ? 2 : 1)}
                    y={svgY + (isPaired ? 2 : 1)}
                    width={pw - (isPaired ? 4 : 2)}
                    height={ph - (isPaired ? 4 : 2)}
                    fill={color}
                    fillOpacity={isSel ? 0.9 : (isPaired ? 0.4 : 0.6)}
                    stroke={isSel ? '#1e40af' : color}
                    strokeWidth={isSel ? 2 : (isPaired ? 1 : 1.5)}
                    strokeDasharray={isPaired ? '4 2' : undefined}
                    rx={2}
                  />
                  {pw > 28 && ph > 14 && (
                    <text
                      x={px + pw / 2} y={svgY + ph / 2}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={Math.min(10, ph / 2.2)}
                      fill="white" fontWeight="600"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {pallet.palletId}
                    </text>
                  )}
                </g>
              );
            })}
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
          {selectedPallet.isMixedSku && selectedPallet.skuBreakdown && (
            <div className="text-blue-600">
              {selectedPallet.skuBreakdown.map(s => `${s.productCode} ×${s.quantity}`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {/* Utilisation bar */}
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
