'use client';

import { PalletPlan } from '@/lib/types';
import { toFloorUnits } from '@/lib/engine/floorPlan';

interface Props {
  pallets: PalletPlan[];
}

function ProductCell({ p }: { p: PalletPlan }) {
  return p.isMixedSku ? (
    <div>
      <span className="inline-block mb-1 text-[10px] font-semibold bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 uppercase tracking-wide">
        Mixed · {p.productCodes?.length ?? 1} SKUs
      </span>
      <div className="truncate text-gray-500" title={(p.productCodes ?? [p.productCode]).join(', ')}>
        {(p.productCodes ?? [p.productCode]).join(', ')}
      </div>
    </div>
  ) : (
    <span className="truncate block" title={p.productCode}>{p.productCode}</span>
  );
}

export default function PalletPlanTable({ pallets }: Props) {
  // Customer column only when at least one pallet is tagged with a customer
  // (results saved before pallets carried customerName have none)
  const showCustomer = pallets.some(p => !!p.customerName);

  // One row per floor position: a stacked pair (bottom + top) shares a row
  const rows = toFloorUnits(pallets);
  const stackedPairs = rows.filter(r => r.stackedPallet).length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        Pallet Plan — {pallets.length} pallet{pallets.length > 1 ? 's' : ''}
        {stackedPairs > 0 && (
          <span className="ml-2 normal-case font-normal text-gray-500">
            · {stackedPairs} stacked pair{stackedPairs > 1 ? 's' : ''} ({rows.length} floor positions)
          </span>
        )}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
              <th className="text-left pb-2 pr-4 font-medium">Pallet</th>
              {showCustomer && <th className="text-left pb-2 pr-4 font-medium">Customer</th>}
              <th className="text-left pb-2 pr-4 font-medium">Product</th>
              <th className="text-left pb-2 pr-4 font-medium">Family</th>
              <th className="text-right pb-2 pr-4 font-medium">Qty</th>
              <th className="text-right pb-2 pr-4 font-medium">L × W × H (mm)</th>
              <th className="text-right pb-2 pr-4 font-medium">CBM</th>
              <th className="text-right pb-2 pr-4 font-medium">Net (kg)</th>
              <th className="text-right pb-2 pr-4 font-medium">Wood (kg)</th>
              <th className="text-right pb-2 font-medium">Gross (kg)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(({ pallet: p, stackedPallet: top, lengthMm }) => {
              // Stacked: bottom listed first; sizes and weights are for the whole stack
              const parts = top ? [p, top] : [p];
              const sum = (f: (x: PalletPlan) => number) => parts.reduce((s, x) => s + f(x), 0);
              const families = Array.from(new Set(parts.map(x => x.family)));

              return (
                <tr key={p.palletId} className={`hover:bg-gray-50 transition-colors ${top ? 'bg-amber-50/40' : ''}`}>
                  <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-gray-700 whitespace-nowrap">
                    {top ? `${p.palletId} + ${top.palletId}` : p.palletId}
                    {top && (
                      <span
                        className="ml-2 font-sans text-[10px] font-semibold bg-amber-100 text-amber-700 rounded px-1.5 py-0.5"
                        title={`${top.palletId} stacked on ${p.palletId}`}
                      >
                        · Stacked
                      </span>
                    )}
                  </td>
                  {showCustomer && (
                    <td className="py-2.5 pr-4 text-xs text-gray-800 max-w-[180px] truncate" title={p.orderRef ? `${p.customerName} · ${p.orderRef}` : p.customerName}>
                      {p.customerName || <span className="text-gray-400 italic">—</span>}
                    </td>
                  )}
                  <td className="py-2.5 pr-4 text-xs text-gray-600 max-w-[220px]">
                    {parts.map(x => (
                      <div key={x.palletId}><ProductCell p={x} /></div>
                    ))}
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex flex-wrap gap-1">
                      {families.map(f => (
                        <span key={f} className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{f}</span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-xs">{sum(x => x.quantity)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-xs text-gray-600 whitespace-nowrap">
                    {lengthMm.toLocaleString()} × {p.widthMm} × {sum(x => x.heightMm)}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-semibold text-xs">{Math.round(sum(x => x.cbm) * 1000) / 1000}</td>
                  <td className="py-2.5 pr-4 text-right text-xs">{(Math.round(sum(x => x.netWeightKg) * 10) / 10).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-right text-xs text-gray-500">{sum(x => x.woodWeightKg)}</td>
                  <td className="py-2.5 text-right font-semibold text-xs">{(Math.round(sum(x => x.totalGrossKg) * 10) / 10).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="pt-2.5 pr-4 text-xs text-gray-700" colSpan={showCustomer ? 4 : 3}>TOTAL</td>
              <td className="pt-2.5 pr-4 text-right text-xs">
                {pallets.reduce((s, p) => s + p.quantity, 0)}
              </td>
              <td className="pt-2.5 pr-4"></td>
              <td className="pt-2.5 pr-4 text-right text-xs">
                {pallets.reduce((s, p) => s + p.cbm, 0).toFixed(3)}
              </td>
              <td className="pt-2.5 pr-4 text-right text-xs">
                {pallets.reduce((s, p) => s + p.netWeightKg, 0).toLocaleString()}
              </td>
              <td className="pt-2.5 pr-4 text-right text-xs">
                {pallets.reduce((s, p) => s + p.woodWeightKg, 0)}
              </td>
              <td className="pt-2.5 text-right text-xs">
                {pallets.reduce((s, p) => s + p.totalGrossKg, 0).toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
