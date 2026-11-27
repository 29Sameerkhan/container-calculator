'use client';

import { PresetResults } from '@/lib/presetResults';
import { PRESET_LABELS, PRESET_SUMMARIES, RULE_PRESETS } from '@/lib/constants';
import { ShipmentResult } from '@/lib/types';
import ContainerFloorPlan from '@/components/calculator/ContainerFloorPlan';
import PdfSideView from '@/components/calculator/PdfSideView';
import PalletPlanTable from '@/components/calculator/PalletPlanTable';

const BADGE: Record<ShipmentResult['containerRecommendation'], { label: string; className: string }> = {
  LCL: { label: 'LCL', className: 'text-yellow-800 bg-yellow-100 border-yellow-300' },
  FCL_20FT: { label: '20ft FCL', className: 'text-green-700 bg-green-50 border-green-300' },
  FCL_40FT: { label: '40ft FCL', className: 'text-blue-700 bg-blue-50 border-blue-300' },
  MULTI_CONTAINER: { label: 'Multiple Containers', className: 'text-orange-700 bg-orange-50 border-orange-300' },
};

function kg(n: number) {
  return `${Math.round(n).toLocaleString('en-US')} kg`;
}

// PDF only: the plan under each rule preset, Standard, Relaxed then Freepack,
// each starting on a new page. Hidden on screen; shown when the PDF is captured.
export default function PdfPresetSections({ results }: { results: PresetResults | null }) {
  if (!results) return null;
  return (
    <div data-pdf-only className="hidden">
      {RULE_PRESETS.map(preset => {
        const r = results[preset];
        if ('error' in r) {
          return (
            <section key={preset} data-pdf-page-break className="pt-2">
              <div className="rounded-xl border-2 border-gray-200 bg-white p-6">
                <h2 className="text-xl font-bold text-gray-900">Rules: {PRESET_LABELS[preset]}</h2>
                <p className="text-sm text-gray-500 mt-1">{PRESET_SUMMARIES[preset]}</p>
                <p className="text-sm text-red-600 mt-3">Could not calculate this preset: {r.error}</p>
              </div>
            </section>
          );
        }
        const badge = BADGE[r.containerRecommendation];
        const label = r.containerRecommendation === 'MULTI_CONTAINER'
          ? `~${r.containersNeeded ?? '?'} × 40ft Containers`
          : badge.label;
        const netKg = r.pallets.reduce((s, p) => s + p.netWeightKg, 0);
        const woodKg = r.pallets.reduce((s, p) => s + p.woodWeightKg, 0);
        return (
          <section key={preset} data-pdf-page-break className="space-y-4 pt-2">
            <div data-pdf-keep className="rounded-xl border-2 border-gray-200 bg-white p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Rules: {PRESET_LABELS[preset]}</h2>
                  <p className="text-sm text-gray-500 mt-1">{PRESET_SUMMARIES[preset]}</p>
                  {r.manualLayout && <p className="text-xs text-blue-700 mt-1">Floor layout adjusted by hand</p>}
                </div>
                <span className={`rounded-lg border-2 px-4 py-2 text-lg font-bold ${badge.className}`}>{label}</span>
              </div>
              <div className="grid grid-cols-4 gap-4 pt-4 border-t border-gray-100">
                <Stat label="Total Pallets" value={String(r.pallets.length)} />
                <Stat label="Net Weight" value={kg(netKg)} />
                <Stat label="Gross Weight" value={kg(r.totalGrossKg)} />
                <Stat label="Wood Weight" value={kg(woodKg)} />
              </div>
            </div>
            <div data-pdf-keep>
              <ContainerFloorPlan pallets={r.pallets} recommendation={r.containerRecommendation} placed={r.placed} />
            </div>
            <PdfSideView pallets={r.pallets} recommendation={r.containerRecommendation} placed={r.placed} />
            <PalletPlanTable pallets={r.pallets} />
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-800">{value}</p>
    </div>
  );
}
