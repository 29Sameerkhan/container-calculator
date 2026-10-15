'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import OrderItemForm, { isComplete } from '@/components/calculator/OrderItemForm';
import PalletPlanTable from '@/components/calculator/PalletPlanTable';
import ContainerSummaryCard from '@/components/calculator/ContainerSummaryCard';
import { OrderItem, ShipmentResult } from '@/lib/types';

// useSearchParams needs a Suspense boundary in the App Router
export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<OrderItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [result, setResult] = useState<ShipmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedId, setSavedId] = useState<number | null>(null);
  // Latest form rows, written synchronously by OrderItemForm on every change
  const rowsRef = useRef<OrderItem[]>([]);
  // Items the current result was calculated from — what Save stores
  const [calculatedItems, setCalculatedItems] = useState<OrderItem[]>([]);
  // Rows the form starts with after loading a saved calculation
  const [initialRows, setInitialRows] = useState<OrderItem[]>([]);
  const [editBanner, setEditBanner] = useState<string | null>(null);
  const [bannerMode, setBannerMode] = useState<'edit' | 'duplicate' | null>(null);

  // Load a saved calculation from ?edit=ID or ?duplicate=ID
  const editParam = searchParams.get('edit');
  const duplicateParam = searchParams.get('duplicate');
  useEffect(() => {
    const id = editParam ?? duplicateParam;
    if (!id) return;
    const mode = editParam ? 'edit' : 'duplicate';
    let cancelled = false;

    fetch(`/api/calculations/${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (!data.success) {
          setError(data.error || `Could not load calculation #${id}`);
          return;
        }
        const calc = data.calculation;
        setCustomerName(calc.customerName);
        setOrderRef(calc.orderRef);
        setItems(calc.items);
        rowsRef.current = calc.items;
        setInitialRows(calc.items);
        setResult(null);
        setCalculatedItems([]);
        setSaveStatus('idle');
        setSavedId(null);
        setResetKey(k => k + 1);
        setBannerMode(mode);
        setEditBanner(
          mode === 'edit'
            ? `Editing #${calc.id} — ${calc.customerName || 'No customer'}`
            : `Duplicated from #${calc.id} — ${calc.customerName || 'No customer'}`
        );
      })
      .catch(() => { if (!cancelled) setError(`Could not load calculation #${id}`); });

    return () => { cancelled = true; };
  }, [editParam, duplicateParam]);

  async function handleCalculate() {
    setSaveStatus('idle');
    setSavedId(null);
    const submitItems = rowsRef.current.filter(row => isComplete(row));
    console.log('[calculate] items being sent:', submitItems);
    if (submitItems.length === 0) {
      setError('Add at least one product line before calculating.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: submitItems, customerName, orderRef }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Calculation failed');
      setResult(data.result);
      setCalculatedItems(submitItems);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setItems([]);
    rowsRef.current = [];
    setInitialRows([]);
    setCalculatedItems([]);
    setResult(null);
    setError(null);
    setCustomerName('');
    setOrderRef('');
    setResetKey(k => k + 1);
    setSaveStatus('idle');
    setSavedId(null);
    setEditBanner(null);
    setBannerMode(null);
    router.replace('/dashboard');
  }

  async function handleSave() {
    if (!result) return;
    setSaveStatus('saving');
    try {
      // Always saves a new record, even when working from an edited calculation
      const res = await fetch('/api/save-calculation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName, orderRef, items: calculatedItems, result }),
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
    <main
      className="min-h-screen"
      style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #f8faff 100%)' }}
    >
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center justify-between"
        style={{ background: 'linear-gradient(90deg, #1E4D8C 0%, #1a3f74 100%)' }}
      >
        <div>
          <h1 className="text-xl font-semibold text-white">Container Load Calculator</h1>
          <p className="text-sm text-blue-200 mt-0.5">SLEKA Industries · Export Operations</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/history"
            className="text-sm text-blue-100 hover:text-white transition-colors"
          >
            History
          </Link>
          <button
            onClick={handleReset}
            className="text-sm text-white border border-white/40 hover:bg-white/10 rounded-md px-3 py-1.5 transition-colors"
          >
            New Calculation
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Edit / duplicate banner */}
        {editBanner && bannerMode && (
          <div
            className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 ${
              bannerMode === 'edit'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-teal-50 border-teal-200 text-teal-800'
            }`}
          >
            <p className="text-sm font-medium">{editBanner}</p>
            <button
              onClick={handleReset}
              className={`text-sm font-medium rounded-md px-3 py-1 border transition-colors ${
                bannerMode === 'edit'
                  ? 'border-amber-300 hover:bg-amber-100'
                  : 'border-teal-300 hover:bg-teal-100'
              }`}
            >
              Clear
            </button>
          </div>
        )}

        {/* Order info */}
        <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6">
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
        <OrderItemForm
          key={resetKey}
          items={items}
          setItems={setItems}
          rowsRef={rowsRef}
          initialRows={initialRows}
        />

        {/* Calculate button */}
        {(items.length > 0 || error) && (
          <div className="flex items-center gap-4">
            {items.length > 0 && (
              <button
                onClick={handleCalculate}
                disabled={loading}
                className="text-white font-medium px-6 py-2.5 rounded-xl text-sm shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #1E4D8C 0%, #2563c4 100%)' }}
              >
                {loading ? 'Calculating…' : `Calculate Container (${items.length} line${items.length > 1 ? 's' : ''})`}
              </button>
            )}
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
              className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium px-6 py-2.5 rounded-xl text-sm transition-colors"
            >
              {saveStatus === 'saving'
                ? 'Saving…'
                : saveStatus === 'saved'
                  ? '✓ Saved'
                  : '💾 Save Calculation'}
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
