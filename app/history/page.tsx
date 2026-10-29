'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatSavedAt } from '@/lib/format';

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
  LCL: { background: '#fef9c3', color: '#854d0e' },
  FCL_20FT: { background: '#dcfce7', color: '#15803d' },
  FCL_40FT: { background: '#dbeafe', color: '#1d4ed8' },
  MULTI_CONTAINER: { background: '#ffedd5', color: '#c2410c' },
};

const CONTAINER_LABEL: Record<string, string> = {
  LCL: 'LCL',
  FCL_20FT: '20ft FCL',
  FCL_40FT: '40ft FCL',
  MULTI_CONTAINER: 'Multi-Container',
};

const EDIT_BUTTON: CSSProperties = { color: '#1E4D8C', background: '#eff6ff', borderColor: '#bfdbfe' };
const COPY_BUTTON: CSSProperties = { color: '#065f46', background: '#ecfdf5', borderColor: '#a7f3d0' };
const EXPORT_BUTTON: CSSProperties = { color: '#6d28d9', background: '#f5f3ff', borderColor: '#ddd6fe' };
const DELETE_BUTTON: CSSProperties = { color: '#dc2626', background: '#fef2f2', borderColor: '#fecaca' };

export default function HistoryPage() {
  const router = useRouter();
  const [rows, setRows] = useState<CalculationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Row awaiting delete confirmation; the modal is open while this is set
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function closeDeleteModal() {
    if (deleting) return;
    setDeleteId(null);
    setDeleteError(null);
  }

  // Escape closes the confirmation
  useEffect(() => {
    if (deleteId === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !deleting) { setDeleteId(null); setDeleteError(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteId, deleting]);

  async function handleDelete() {
    if (deleteId === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/calculations/${deleteId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setRows(prev => prev.filter(r => r.id !== deleteId));
      setDeleteId(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

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
                    <tr
                      key={row.id}
                      onClick={() => router.push('/history/' + row.id)}
                      className="cursor-pointer hover:bg-blue-50/40 transition-colors"
                    >
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
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatSavedAt(row.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={e => { e.stopPropagation(); router.push(`/dashboard?edit=${row.id}`); }}
                            className="text-xs font-medium rounded-lg border px-2.5 py-1 whitespace-nowrap hover:opacity-80 transition-opacity"
                            style={EDIT_BUTTON}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); router.push(`/dashboard?duplicate=${row.id}`); }}
                            className="text-xs font-medium rounded-lg border px-2.5 py-1 whitespace-nowrap hover:opacity-80 transition-opacity"
                            style={COPY_BUTTON}
                          >
                            📋 Copy
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); router.push(`/history/${row.id}?export=1`); }}
                            className="text-xs font-medium rounded-lg border px-2.5 py-1 whitespace-nowrap hover:opacity-80 transition-opacity"
                            style={EXPORT_BUTTON}
                            title="Open this plan and download it as PDF"
                          >
                            📄 Export
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteError(null); setDeleteId(row.id); }}
                            className="text-xs font-medium rounded-lg border px-2.5 py-1 whitespace-nowrap hover:opacity-80 transition-opacity"
                            style={DELETE_BUTTON}
                          >
                            🗑 Delete
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

      {/* Delete confirmation */}
      {deleteId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4"
          onClick={closeDeleteModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-blue-100 p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="delete-title" className="text-base font-semibold text-gray-900">
              Delete calculation #{deleteId}?
            </h2>
            <p className="mt-1 text-sm text-gray-500">This cannot be undone.</p>
            {deleteError && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{deleteError}</p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={closeDeleteModal}
                disabled={deleting}
                className="text-sm font-medium rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-sm font-medium rounded-lg px-4 py-2 text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="py-6 text-center text-xs text-gray-400">
        SLEKA Industries Pvt. Ltd. · Container Load Planning System
      </footer>
    </main>
  );
}
