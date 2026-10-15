'use client';

import { PalletPlan, ShipmentResult } from '@/lib/types';
import { CONTAINERS } from '@/lib/constants';

interface ContainerSplit {
  container: number;
  firstPalletId: string;
  lastPalletId: string;
  cbm: number;
  grossKg: number;
}

// Rough even split of pallets across N containers by position in the list.
// Not a load plan: a chunk can exceed a 40ft's limits, which the table flags.
function splitPallets(pallets: PalletPlan[], containers: number): ContainerSplit[] {
  const perContainer = Math.ceil(pallets.length / containers);
  const splits: ContainerSplit[] = [];
  for (let i = 0; i < containers; i++) {
    const chunk = pallets.slice(i * perContainer, (i + 1) * perContainer);
    if (chunk.length === 0) break;
    splits.push({
      container: i + 1,
      firstPalletId: chunk[0].palletId,
      lastPalletId: chunk[chunk.length - 1].palletId,
      cbm: Math.round(chunk.reduce((s, p) => s + p.cbm, 0) * 1000) / 1000,
      grossKg: Math.round(chunk.reduce((s, p) => s + p.totalGrossKg, 0) * 10) / 10,
    });
  }
  return splits;
}

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
  const isMulti = result.containerRecommendation === 'MULTI_CONTAINER';
  const label = isMulti ? `~${result.containersNeeded ?? '?'} × 40ft Containers` : rec.label;
  // Results saved before containersNeeded existed have no split to show
  const splits = isMulti && result.containersNeeded
    ? splitPallets(result.pallets, result.containersNeeded)
    : [];
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
          <p className={`text-3xl font-bold ${rec.color}`}>{label}</p>
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

      {/* Suggested split across containers — only for MULTI_CONTAINER */}
      {splits.length > 0 && (
        <div className="mt-4 rounded-xl overflow-hidden border border-blue-100 bg-white">
          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white" style={{ background: '#1E4D8C' }}>
            Suggested Split
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="uppercase tracking-wide border-b border-blue-100" style={{ color: '#1E4D8C', background: '#f0f4ff' }}>
                  <th className="text-left px-4 py-2 font-semibold">Container</th>
                  <th className="text-left px-4 py-2 font-semibold">Pallets</th>
                  <th className="text-right px-4 py-2 font-semibold">CBM</th>
                  <th className="text-right px-4 py-2 font-semibold">Gross KG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-50">
                {splits.map(s => {
                  const overCbm = s.cbm > CONTAINERS.FCL_40FT.maxCBM;
                  const overKg = s.grossKg > CONTAINERS.FCL_40FT.maxPayloadKg;
                  return (
                    <tr key={s.container}>
                      <td className="px-4 py-2 font-semibold" style={{ color: '#1E4D8C' }}>Container {s.container}</td>
                      <td className="px-4 py-2 font-mono text-gray-700">
                        {s.firstPalletId === s.lastPalletId ? s.firstPalletId : `${s.firstPalletId} to ${s.lastPalletId}`}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono ${overCbm ? 'text-red-600 font-semibold' : ''}`}
                        title={overCbm ? `Over the 40ft limit of ${CONTAINERS.FCL_40FT.maxCBM} m³` : undefined}
                      >
                        {s.cbm}
                      </td>
                      <td
                        className={`px-4 py-2 text-right ${overKg ? 'text-red-600 font-semibold' : ''}`}
                        title={overKg ? `Over the 40ft payload of ${CONTAINERS.FCL_40FT.maxPayloadKg.toLocaleString()} kg` : undefined}
                      >
                        {s.grossKg.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {splits.some(s => s.cbm > CONTAINERS.FCL_40FT.maxCBM || s.grossKg > CONTAINERS.FCL_40FT.maxPayloadKg) && (
            <p className="px-4 py-2 text-xs text-red-600 border-t border-blue-50">
              Values in red exceed a 40ft container — rebalance pallets before booking.
            </p>
          )}
        </div>
      )}

      {/* Per-order split — only for consolidated shipments. Results saved before
          perCustomer existed have no such field, hence the fallback. */}
      {(result.perCustomer ?? []).length > 1 && (
        <div className="mt-4 rounded-xl overflow-hidden border border-blue-100 bg-white">
          <p
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"
            style={{ background: 'linear-gradient(90deg, #1E4D8C 0%, #1a3f74 100%)' }}
          >
            Per Customer Breakdown
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="uppercase tracking-wide border-b border-blue-100" style={{ color: '#1E4D8C', background: '#f0f4ff' }}>
                  <th className="text-left px-4 py-2 font-semibold">Customer</th>
                  <th className="text-left px-4 py-2 font-semibold">Order Ref</th>
                  <th className="text-right px-4 py-2 font-semibold">CBM</th>
                  <th className="text-right px-4 py-2 font-semibold">Gross KG</th>
                  <th className="text-right px-4 py-2 font-semibold">Pallets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-50">
                {result.perCustomer.map((c, i) => (
                  <tr key={`${c.customerName}-${c.orderRef}-${i}`}>
                    <td className="px-4 py-2 font-medium text-gray-800">
                      {c.customerName || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {c.orderRef || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{c.totalCBM}</td>
                    <td className="px-4 py-2 text-right">{c.totalGrossKg.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-semibold" style={{ color: '#1E4D8C' }}>{c.palletCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
