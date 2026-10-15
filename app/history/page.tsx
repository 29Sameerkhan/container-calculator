'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface CalculationRow {
  id: number;
  customerName: string;
  orderRef: string;
  totalCbm: number;
  totalGrossKg: number;
  containerRecommendation: string;
  palletCount: number;
  createdAt: string;
}

const CONTAINER_BADGE: Record<string, string> = {
  FCL_20FT: 'bg-green-100 text-green-700',
  FCL_40FT: 'bg-blue-100 text-blue-700',
  MULTI_CONTAINER: 'bg-orange-100 text-orange-700',
};

const CONTAINER_LABEL: Record<string, string> = {
  FCL_20FT: '20ft FCL',
  FCL_40FT: '40ft FCL',
  MULTI_CONTAINER: 'Multi-Container',
};

function formatDate(iso: string) {
  const d = new Date(iso.replace(' ', 'T') + 'Z'); // Turso stores UTC without Z
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

export default function HistoryPage() {
  const [rows, setRows] = useState<CalculationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/calculations')
      .then(r => r.json())
      .then(data => {
        if (data.success) setRows(data.calculations);
        else setError(data.error || 'Failed to load');
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Calculation History</h1>
          <p className="text-sm text-gray-500 mt-0.5">SLEKA Industries · Export Operations</p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-md px-3 py-1.5 transition-colors font-medium"
        >
          + New Calculation
        </Link>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {loading && (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        )}
        {error && (
          <div className="text-center py-16 text-red-500 text-sm">{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No saved calculations yet.</p>
            <Link href="/dashboard" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
              Create your first calculation →
            </Link>
          </div>
        )}
        {!loading && rows.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium">#</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium">Order Ref</th>
                  <th className="text-left px-4 py-3 font-medium">Container</th>
                  <th className="text-right px-4 py-3 font-medium">CBM</th>
                  <th className="text-right px-4 py-3 font-medium">Gross (kg)</th>
                  <th className="text-right px-4 py-3 font-medium">Pallets</th>
                  <th className="text-left px-4 py-3 font-medium">Saved At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">#{row.id}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {row.customerName || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {row.orderRef || <span className="text-gray-400 italic">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CONTAINER_BADGE[row.containerRecommendation] ?? 'bg-gray-100 text-gray-600'}`}>
                        {CONTAINER_LABEL[row.containerRecommendation] ?? row.containerRecommendation}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{row.totalCbm}</td>
                    <td className="px-4 py-3 text-right text-xs">{row.totalGrossKg.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-xs">{row.palletCount}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
