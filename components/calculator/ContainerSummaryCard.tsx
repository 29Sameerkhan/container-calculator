'use client';

import { ShipmentResult } from '@/lib/types';
import { CONTAINERS } from '@/lib/constants';

interface Props {
  result: ShipmentResult;
  customerName: string;
  orderRef: string;
}

const CONTAINER_LABELS: Record<ShipmentResult['containerRecommendation'], { label: string; color: string; bg: string }> = {
  LCL: { label: 'LCL', color: 'text-yellow-800', bg: 'bg-yellow-100 border-yellow-200' },
  FCL_20FT: { label: '20ft FCL', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  FCL_40FT: { label: '40ft FCL', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  MULTI_CONTAINER: { label: 'Multiple Containers', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
};

export default function ContainerSummaryCard({ result, customerName, orderRef }: Props) {
  const rec = CONTAINER_LABELS[result.containerRecommendation];
  const container = result.containerRecommendation === 'FCL_20FT'
    ? CONTAINERS.FCL_20FT
    : CONTAINERS.FCL_40FT;

  // Utilisation only makes sense against a single full container
  const isFcl = result.containerRecommendation === 'FCL_20FT' || result.containerRecommendation === 'FCL_40FT';
  const cbmUtil = isFcl
    ? ((result.totalCBM / container.maxCBM) * 100).toFixed(1)
    : null;
  const wtUtil = isFcl
    ? ((result.totalGrossKg / container.maxPayloadKg) * 100).toFixed(1)
    : null;

  return (
    <div className={`rounded-xl border-2 p-6 ${rec.bg}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Recommendation</p>
          <p className={`text-3xl font-bold ${rec.color}`}>{rec.label}</p>
          {customerName && (
            <p className="text-sm text-gray-600 mt-1">{customerName}{orderRef ? ` · ${orderRef}` : ''}</p>
          )}
        </div>
        <div className="text-right">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Total CBM</p>
              <p className="text-2xl font-semibold text-gray-800">{result.totalCBM}</p>
              {cbmUtil && <p className="text-xs text-gray-500">{cbmUtil}% utilised</p>}
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Total Gross</p>
              <p className="text-2xl font-semibold text-gray-800">{result.totalGrossKg.toLocaleString()} kg</p>
              {wtUtil && <p className="text-xs text-gray-500">{wtUtil}% of payload</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 pt-4 border-t border-current/10">
        <div>
          <p className="text-xs text-gray-500">Total Pallets</p>
          <p className="text-lg font-semibold text-gray-800">{result.pallets.length}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Net Weight</p>
          <p className="text-lg font-semibold text-gray-800">
            {result.pallets.reduce((s, p) => s + p.netWeightKg, 0).toLocaleString()} kg
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Wood Weight</p>
          <p className="text-lg font-semibold text-gray-800">
            {result.pallets.reduce((s, p) => s + p.woodWeightKg, 0)} kg
          </p>
        </div>
      </div>

      {result.warnings.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span className="text-amber-500 mt-0.5 text-xs">⚠</span>
              <p className="text-xs text-amber-800">{w}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
