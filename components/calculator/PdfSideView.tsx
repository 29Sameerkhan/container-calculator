'use client';

import { CONTAINERS, packPallets, PlacedPallet } from '@/lib/engine/floorPlan';
import { familyColorMap } from '@/lib/familyColors';
import { PalletPlan, ShipmentResult } from '@/lib/types';

interface Props {
  pallets: PalletPlan[];
  recommendation: ShipmentResult['containerRecommendation'];
  placed?: PlacedPallet[];
}

const SCALE = 0.05; // px per mm
const OVERFLOW_COLOR = '#ef4444';
// The outline's bottom edge is lost when the SVG is captured without this margin
const CAPTURE_MARGIN_PX = 6;

function px(mm: number) {
  return Math.round(mm * SCALE);
}

// PDF only: the container seen from the side, along its length, to scale. Each
// pallet sits at its position along the container and at its true height; a stacked
// pair is the bottom pallet with the top one on it. Pallets side by side across the
// width would hide each other in one drawing, so each row across the width gets its own.
export default function PdfSideView({ pallets, recommendation, placed: savedPlaced }: Props) {
  // LCL has no container to draw
  if (recommendation === 'LCL') return null;

  const containerKey = recommendation === 'FCL_20FT' ? 'FCL_20FT' : 'FCL_40FT';
  const container = CONTAINERS[containerKey];
  const placed = savedPlaced ?? packPallets(pallets, container.LENGTH);
  if (placed.length === 0) return null;

  // Pallets sharing a strip (same x) sit in rows across the width
  const strips = new Map<number, PlacedPallet[]>();
  for (const p of placed) {
    strips.set(p.x, [...(strips.get(p.x) ?? []), p]);
  }
  const rows: PlacedPallet[][] = [];
  strips.forEach(strip => {
    [...strip].sort((a, b) => a.y - b.y).forEach((p, row) => {
      (rows[row] ??= []).push(p);
    });
  });

  const cL = px(container.LENGTH);
  const cH = px(container.HEIGHT);
  const familyColors = familyColorMap(pallets);

  return (
    <div data-pdf-only className="hidden pt-4">
      <div data-pdf-keep className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Side View</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {containerKey === 'FCL_20FT' ? '20ft' : '40ft'} · {container.LENGTH / 1000}m long × {container.HEIGHT / 1000}m high · one drawing per row across the container width
            {recommendation === 'MULTI_CONTAINER' && (
              <span className="ml-2 text-amber-600 font-medium">· Showing container 1 of split shipment</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {rows.map((row, r) => (
            <div key={r}>
              <p className="text-[11px] font-medium text-gray-500 mb-1">Row {r + 1} of {rows.length}</p>
              <svg width={cL + 2} height={cH + 2 + CAPTURE_MARGIN_PX} style={{ display: 'block' }}>
                <rect x={1} y={1} width={cL} height={cH} fill="#f8faff" stroke="#1e40af" strokeWidth={2} rx={2} />
                {row.flatMap(p => {
                  const stack = p.stackedPallet
                    ? [{ pallet: p.pallet, baseMm: 0, isTop: false }, { pallet: p.stackedPallet, baseMm: p.pallet.heightMm, isTop: true }]
                    : [{ pallet: p.pallet, baseMm: 0, isTop: false }];
                  return stack.map(({ pallet, baseMm, isTop }) => {
                    // Overflow pallets show as a sliver at the container end, as on the floor plan
                    const x = px(Math.min(p.x, container.LENGTH - 10));
                    const w = p.overflow ? Math.max(4, cL - x) : px(pallet.lengthMm);
                    const h = px(pallet.heightMm);
                    const y = 1 + cH - px(baseMm) - h;
                    const color = p.overflow ? OVERFLOW_COLOR : (familyColors[pallet.family] ?? '#94a3b8');
                    return (
                      <g key={pallet.palletId}>
                        <rect
                          x={x + 1} y={y} width={Math.max(1, w - 1)} height={Math.max(1, h - 1)}
                          fill={color}
                          // The top pallet of a stack is a lighter shade of the same colour
                          fillOpacity={isTop ? 0.55 : 0.9}
                          stroke="#ffffff"
                          strokeWidth={1}
                        />
                        {w > 24 && h > 10 && (
                          <text
                            x={x + 1 + w / 2} y={y + h / 2}
                            textAnchor="middle" dominantBaseline="middle"
                            fontSize={Math.min(10, h - 2)} fontWeight="700" fill="#ffffff"
                            stroke="rgba(15, 23, 42, 0.5)" strokeWidth={2} paintOrder="stroke"
                          >
                            {pallet.palletId}
                          </text>
                        )}
                      </g>
                    );
                  });
                })}
              </svg>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
