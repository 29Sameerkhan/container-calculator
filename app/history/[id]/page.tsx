'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import ContainerSummaryCard from '@/components/calculator/ContainerSummaryCard';
import PalletPlanTable from '@/components/calculator/PalletPlanTable';
import { formatSavedAt } from '@/lib/format';
import { ShipmentResult } from '@/lib/types';

interface SavedCalculation {
  id: number;
  customerName: string;
  orderRef: string;
  result: ShipmentResult;
  createdAt: string;
}

export default function CalculationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [calc, setCalc] = useState<SavedCalculation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/calculations/${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.success) setCalc(data.calculation);
        else setError(data.error || 'Failed to load calculation');
      })
      .catch(() => { if (!cancelled) setError('Network error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // A consolidated shipment has more than one order in perCustomer. Results
  // saved before multi-order support have no perCustomer, so count as single.
  const isConsolidated = (calc?.result.perCustomer?.length ?? 0) > 1;

  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #f8faff 100%)' }}
    >
      <div
        className="px-6 py-4 flex items-center justify-between"
        style={{ background: 'linear-gradient(90deg, #1E4D8C 0%, #1a3f74 100%)' }}
      >
        <div>
          <h1 className="text-xl font-semibold text-white">
            Calculation {calc ? `#${calc.id}` : 'Detail'}
          </h1>
          <p className="text-sm text-blue-200 mt-0.5">SLEKA Industries · Export Operations</p>
        </div>
        <Link
          href="/history"
          className="text-sm text-white border border-white/40 hover:bg-white/10 rounded-md px-3 py-1.5 transition-colors font-medium"
        >
          ← History
        </Link>
      </div>

      <div className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-16" role="status">
            <div
              className="h-8 w-8 rounded-full border-4 border-blue-100 animate-spin"
              style={{ borderTopColor: '#1E4D8C' }}
            />
            <p className="text-sm text-gray-400">Loading calculation…</p>
          </div>
        )}

        {!loading && error && (
          <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-8 text-center">
            <p className="text-sm font-medium text-red-600">{error}</p>
            <Link href="/history" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
              ← Back to History
            </Link>
          </div>
        )}

        {!loading && !error && calc && (
          <>
            {/* Order details */}
            <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {isConsolidated ? 'Customers' : 'Customer'}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 mt-1">
                    {calc.customerName || <span className="text-gray-400 italic font-normal">—</span>}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {isConsolidated ? 'Order Refs' : 'Order Ref'}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 mt-1">
                    {calc.orderRef || <span className="text-gray-400 italic font-normal">—</span>}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Saved</p>
                  <p className="text-sm font-semibold text-gray-900 mt-1">{formatSavedAt(calc.createdAt)}</p>
                </div>
              </div>
            </div>

            <ContainerSummaryCard
              result={calc.result}
              customerName={isConsolidated ? '' : calc.customerName}
              orderRef={isConsolidated ? '' : calc.orderRef}
            />
            <PalletPlanTable pallets={calc.result.pallets} />
          </>
        )}
      </div>

      <footer className="py-6 text-center text-xs text-gray-400">
        SLEKA Industries Pvt. Ltd. · Container Load Planning System
      </footer>
    </main>
  );
}
