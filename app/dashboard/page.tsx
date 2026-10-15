'use client';

import { useState } from 'react';
import Link from 'next/link';
import OrderItemForm from '@/components/calculator/OrderItemForm';
import PalletPlanTable from '@/components/calculator/PalletPlanTable';
import ContainerSummaryCard from '@/components/calculator/ContainerSummaryCard';
import { OrderItem, ShipmentResult } from '@/lib/types';

export default function DashboardPage() {
  const [items, setItems] = useState<OrderItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [result, setResult] = useState<ShipmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedId, setSavedId] = useState<number | null>(null);

  async function handleCalculate() {
    setSaveStatus('idle');
    setSavedId(null);
    if (items.length === 0) {
      setError('Add at least one product line before calculating.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, customerName, orderRef }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Calculation failed');
      setResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setItems([]);
    setResult(null);
    setError(null);
    setCustomerName('');
    setOrderRef('');
    setResetKey(k => k + 1);
    setSaveStatus('idle');
    setSavedId(null);
  }

  async function handleSave() {
    if (!result) return;
    setSaveStatus('saving');
    try {
      const res = await fetch('/api/save-calculation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName, orderRef, items, result }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setSavedId(data.id);
      setSaveStatus('saved');
    } catch (e) {
      console.error(e);
      setSaveStatus('error');
    }
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Container Load Calculator</h1>
          <p className="text-sm text-gray-500 mt-0.5">SLEKA Industries · Export Operations</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/history"
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            History
          </Link>
          <button
            onClick={handleReset}
            className="text-sm text-gray-500 hover:text-gray-800 border border-gray-300 rounded-md px-3 py-1.5 transition-colors"
          >
            New Calculation
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Order info */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Order Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="e.g. NHY Trading PLC"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Order Reference</label>
              <input
                type="text"
                value={orderRef}
                onChange={e => setOrderRef(e.target.value)}
                placeholder="e.g. PO-2026-00142"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Product line entry */}
        <OrderItemForm key={resetKey} items={items} setItems={setItems} />

        {/* Calculate button */}
        {items.length > 0 && (
          <div className="flex items-center gap-4">
            <button
              onClick={handleCalculate}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Calculating…' : `Calculate Container (${items.length} line${items.length > 1 ? 's' : ''})`}
            </button>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            <ContainerSummaryCard result={result} customerName={customerName} orderRef={orderRef} />
            <PalletPlanTable pallets={result.pallets} />
          </div>
        )}

        {result && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving' || saveStatus === 'saved'}
              className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium px-6 py-2.5 rounded-lg text-sm transition-colors"
            >
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : 'Save Calculation'}
            </button>
            {saveStatus === 'saved' && savedId && (
              <p className="text-sm text-green-700">Saved as #{savedId}</p>
            )}
            {saveStatus === 'error' && (
              <p className="text-sm text-red-600">Save failed — check console</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
