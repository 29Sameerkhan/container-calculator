'use client';

import { PalletPlan } from '@/lib/types';

interface Props {
  pallets: PalletPlan[];
}

export default function PalletPlanTable({ pallets }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        Pallet Plan — {pallets.length} pallet{pallets.length > 1 ? 's' : ''}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
              <th className="text-left pb-2 pr-4 font-medium">Pallet</th>
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
            {pallets.map((p) => (
              <tr key={p.palletId} className="hover:bg-gray-50 transition-colors">
                <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-gray-700">{p.palletId}</td>
                <td className="py-2.5 pr-4 text-xs text-gray-600 max-w-[180px] truncate" title={p.productCode}>{p.productCode}</td>
                <td className="py-2.5 pr-4">
                  <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{p.family}</span>
                </td>
                <td className="py-2.5 pr-4 text-right text-xs">{p.quantity}</td>
                <td className="py-2.5 pr-4 text-right font-mono text-xs text-gray-600">
                  {p.lengthMm.toLocaleString()} × {p.widthMm} × {p.heightMm}
                </td>
                <td className="py-2.5 pr-4 text-right font-semibold text-xs">{p.cbm}</td>
                <td className="py-2.5 pr-4 text-right text-xs">{p.netWeightKg.toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-right text-xs text-gray-500">{p.woodWeightKg}</td>
                <td className="py-2.5 text-right font-semibold text-xs">{p.totalGrossKg.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="pt-2.5 pr-4 text-xs text-gray-700" colSpan={3}>TOTAL</td>
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
