'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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

const CONTAINER_BADGE: Record<string, CSSProperties> = {
  FCL_20FT: { background: '#dcfce7', color: '#15803d' },
  FCL_40FT: { background: '#dbeafe', color: '#1d4ed8' },
  MULTI_CONTAINER: { background: '#ffedd5', color: '#c2410c' },
};

const CONTAINER_LABEL: Record<string, string> = {
  FCL_20FT: '20ft FCL',
  FCL_40FT: '40ft FCL',
  MULTI_CONTAINER: 'Multi-Container',
};

const EDIT_BUTTON: CSSProperties = { color: '#1E4D8C', background: '#eff6ff', borderColor: '#bfdbfe' };
const COPY_BUTTON: CSSProperties = { color: '#065f46', background: '#ecfdf5', borderColor: '#a7f3d0' };

function formatDate(iso: string) {
  const d = new Date(iso.replace(' ', 'T') + 'Z'); // Turso stores UTC without Z
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

export default function HistoryPage() {
  const router = useRouter();
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

  const totalCbm = rows.reduce((s, r) => s + r.totalCbm, 0);
  const totalGrossKg = rows.reduce((s, r) => s + r.totalGrossKg, 0);
  const stats = [
    { icon: '🚢', label: 'Total Shipments', value: rows.length.toLocaleString() },
    { icon: '📦', label: 'Total CBM Planned', value: `${totalCbm.toFixed(2)} m³` },
    { icon: '⚖️', label: 'Total Gross Weight', value: `${Math.round(totalGrossKg).toLocaleString()} kg` },
  ];

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
          <h1 className="text-xl font-semibold text-white">Calculation History</h1>
          <p className="text-sm text-blue-200 mt-0.5">SLEKA Industries · Export Operations</p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-white border border-white/40 hover:bg-white/10 rounded-md px-3 py-1.5 transition-colors font-medium"
        >
          + New Calculation
        </Link>
      </div>

      <div className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 space-y-6">
        {loading && (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        )}
        {error && (
          <div className="text-center py-16 text-red-500 text-sm">{error}</div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {stats.map(s => (
              <div key={s.label} className="bg-white rounded-2xl border border-blue-100 shadow-sm p-5 flex items-center gap-4">
                <span className="text-3xl" aria-hidden>{s.icon}</span>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{s.label}</p>
                  <p className="text-2xl font-semibold text-gray-900 mt-0.5">{s.value}</p>
                </div>
              </div>
            ))}
          </div>
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
          <div className="bg-white rounded-2xl border border-blue-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-xs text-gray-500 uppercase tracking-wide border-b border-blue-100"
                    style={{ background: 'linear-gradient(90deg, #f0f4ff, #f8faff)' }}
                  >
                    <th className="text-left px-4 py-3 font-medium">#</th>
                    <th className="text-left px-4 py-3 font-medium">Customer</th>
                    <th className="text-left px-4 py-3 font-medium">Order Ref</th>
                    <th className="text-left px-4 py-3 font-medium">Container</th>
                    <th className="text-right px-4 py-3 font-medium">CBM</th>
                    <th className="text-right px-4 py-3 font-medium">Gross (kg)</th>
                    <th className="text-right px-4 py-3 font-medium">Pallets</th>
                    <th className="text-left px-4 py-3 font-medium">Saved At</th>
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map(row => (
                    <tr key={row.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-xs" style={{ color: '#1E4D8C' }}>#{row.id}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {row.customerName || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {row.orderRef || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={CONTAINER_BADGE[row.containerRecommendation] ?? { background: '#f3f4f6', color: '#4b5563' }}
                        >
                          {CONTAINER_LABEL[row.containerRecommendation] ?? row.containerRecommendation}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.totalCbm}</td>
                      <td className="px-4 py-3 text-right text-xs">{row.totalGrossKg.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-xs">{row.palletCount}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => router.push(`/dashboard?edit=${row.id}`)}
                            className="text-xs font-medium rounded-lg border px-2.5 py-1 whitespace-nowrap hover:opacity-80 transition-opacity"
                            style={EDIT_BUTTON}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => router.push(`/dashboard?duplicate=${row.id}`)}
                            className="text-xs font-medium rounded-lg border px-2.5 py-1 whitespace-nowrap hover:opacity-80 transition-opacity"
                            style={COPY_BUTTON}
                          >
                            📋 Copy
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <footer className="py-6 text-center text-xs text-gray-400">
        SLEKA Industries Pvt. Ltd. · Container Load Planning System
      </footer>
    </main>
  );
}
