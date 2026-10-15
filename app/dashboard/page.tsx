'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import OrderItemForm, { isComplete } from '@/components/calculator/OrderItemForm';
import PalletPlanTable from '@/components/calculator/PalletPlanTable';
import ContainerSummaryCard from '@/components/calculator/ContainerSummaryCard';
import ContainerFloorPlan from '@/components/calculator/ContainerFloorPlan';
import { OrderItem, ShipmentOrder, ShipmentResult } from '@/lib/types';

// One order card on the dashboard. `items` are the rows its form starts with
// (empty for a new order, or loaded from a saved calculation); live edits are
// kept in rowsByOrder, not here.
interface OrderDraft {
  id: string;
  customerName: string;
  orderRef: string;
  items: OrderItem[];
}

function newId(): string {
  // randomUUID needs a secure context (https or localhost); fall back elsewhere
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function makeOrder(customerName = '', orderRef = '', items: OrderItem[] = []): OrderDraft {
  return { id: newId(), customerName, orderRef, items };
}

// Saved items_json is OrderItem[] for a single order, or ShipmentOrder[] for a multi-order shipment
function isOrderList(value: unknown): value is ShipmentOrder[] {
  return Array.isArray(value) && value.length > 0 && Array.isArray((value[0] as ShipmentOrder)?.items);
}

const INPUT_CLASS =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

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

  const [orders, setOrders] = useState<OrderDraft[]>(() => [makeOrder()]);
  // Latest rows per order, written synchronously by each OrderItemForm on every change
  const rowsByOrder = useRef(new Map<string, OrderItem[]>());
  // Bumped on every row change so line counts and the Calculate button re-render
  const [, setRowsVersion] = useState(0);
  const [result, setResult] = useState<ShipmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedId, setSavedId] = useState<number | null>(null);
  // Orders the current result was calculated from — what Save stores
  const [calculatedOrders, setCalculatedOrders] = useState<ShipmentOrder[]>([]);
  const [editBanner, setEditBanner] = useState<string | null>(null);
  const [bannerMode, setBannerMode] = useState<'edit' | 'duplicate' | null>(null);
  // Pending auto-reset after a save; cancelled if the page is left first, so it
  // can't pull the user back to /dashboard from another page
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const isMultiOrder = orders.length > 1;
  const liveRows = (order: OrderDraft) => rowsByOrder.current.get(order.id) ?? order.items;
  const completeLines = orders.map(o => liveRows(o).filter(isComplete).length);
  const totalLines = completeLines.reduce((s, n) => s + n, 0);

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
        const loaded = isOrderList(calc.items)
          ? calc.items.map((o: ShipmentOrder) => makeOrder(o.customerName, o.orderRef, o.items))
          : [makeOrder(calc.customerName, calc.orderRef, calc.items)];
        rowsByOrder.current = new Map();
        setOrders(loaded);
        setResult(null);
        setCalculatedOrders([]);
        setError(null);
        setSaveStatus('idle');
        setSavedId(null);
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

  function handleRowsChange(orderId: string, rows: OrderItem[]) {
    rowsByOrder.current.set(orderId, rows);
    setRowsVersion(v => v + 1);
  }

  function updateOrder(orderId: string, field: 'customerName' | 'orderRef', value: string) {
    setOrders(prev => prev.map(o => (o.id === orderId ? { ...o, [field]: value } : o)));
  }

  function addOrder() {
    setOrders(prev => [...prev, makeOrder()]);
  }

  function removeOrder(orderId: string) {
    if (orders.length <= 1) return;
    rowsByOrder.current.delete(orderId);
    setOrders(prev => prev.filter(o => o.id !== orderId));
  }

  async function handleCalculate() {
    setSaveStatus('idle');
    setSavedId(null);
    const submitOrders: ShipmentOrder[] = orders.map(o => ({
      customerName: o.customerName,
      orderRef: o.orderRef,
      items: liveRows(o).filter(row => isComplete(row)),
    }));
    console.log('[calculate] orders being sent:', submitOrders);

    const emptyIndex = submitOrders.findIndex(o => o.items.length === 0);
    if (emptyIndex !== -1) {
      const name = submitOrders[emptyIndex].customerName;
      setError(
        isMultiOrder
          ? `Order ${emptyIndex + 1}${name ? ` (${name})` : ''} has no complete product lines — fill it in or remove it.`
          : 'Add at least one product line before calculating.'
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: submitOrders }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Calculation failed');
      setResult(data.result);
      setCalculatedOrders(submitOrders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    rowsByOrder.current = new Map();
    setOrders([makeOrder()]);
    setCalculatedOrders([]);
    setResult(null);
    setError(null);
    setSaveStatus('idle');
    setSavedId(null);
    setEditBanner(null);
    setBannerMode(null);
    router.replace('/dashboard');
  }

  async function handleSave() {
    if (!result || calculatedOrders.length === 0) return;
    setSaveStatus('saving');
    try {
      // Single order: saved exactly as before. Multi-order: names joined for the
      // history list, and the full order list kept in items so it can be reloaded.
      const single = calculatedOrders.length === 1;
      const body = single
        ? {
            customerName: calculatedOrders[0].customerName,
            orderRef: calculatedOrders[0].orderRef,
            items: calculatedOrders[0].items,
            result,
          }
        : {
            customerName: calculatedOrders.map(o => o.customerName).filter(Boolean).join(' + '),
            orderRef: calculatedOrders.map(o => o.orderRef).filter(Boolean).join(', '),
            items: calculatedOrders,
            result,
          };
      // Always saves a new record, even when working from an edited calculation
      const res = await fetch('/api/save-calculation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setSavedId(data.id);
      setSaveStatus('saved');
      // Clear the form for the next calculation once the confirmation has been seen
      resetTimer.current = setTimeout(handleReset, 2000);
    } catch (e) {
      console.error(e);
      setSaveStatus('error');
    }
  }

  // Shown on the summary card: one customer as-is, several joined
  const displayName = orders.map(o => o.customerName).filter(Boolean).join(' + ');
  const displayRef = orders.map(o => o.orderRef).filter(Boolean).join(', ');

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

        {/* Orders — the same element tree for one or many, so forms never remount
            (and lose their rows) when a second order is added or removed */}
        {orders.map((order, i) => (
          <section
            key={order.id}
            className={isMultiOrder ? 'space-y-4 rounded-2xl border-2 border-blue-200 bg-blue-50/40 p-4' : 'space-y-6'}
          >
            {isMultiOrder && (
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: '#1E4D8C' }}>
                  Order {i + 1}
                  {order.customerName && <span className="ml-2 normal-case font-medium text-gray-600">— {order.customerName}</span>}
                  <span className="ml-2 normal-case font-normal text-gray-500">({completeLines[i]} line{completeLines[i] === 1 ? '' : 's'})</span>
                </h2>
                <button
                  onClick={() => removeOrder(order.id)}
                  aria-label={`Remove order ${i + 1}`}
                  title="Remove this order"
                  className="rounded-md p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <X size={16} />
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
                    value={order.customerName}
                    onChange={e => updateOrder(order.id, 'customerName', e.target.value)}
                    placeholder="e.g. NHY Trading PLC"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Order Reference</label>
                  <input
                    type="text"
                    value={order.orderRef}
                    onChange={e => updateOrder(order.id, 'orderRef', e.target.value)}
                    placeholder="e.g. PO-2026-00142"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
            </div>

            {/* Product line entry */}
            <OrderItemForm
              initialRows={order.items}
              onRowsChange={rows => handleRowsChange(order.id, rows)}
            />
          </section>
        ))}

        <button
          onClick={addOrder}
          className="w-full rounded-2xl border-2 border-dashed border-blue-200 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50 hover:border-blue-300 transition-colors"
        >
          + Add Another Order
        </button>

        {/* Calculate button */}
        {(totalLines > 0 || error) && (
          <div className="flex items-center gap-4">
            {totalLines > 0 && (
              <button
                onClick={handleCalculate}
                disabled={loading}
                className="text-white font-medium px-6 py-2.5 rounded-xl text-sm shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #1E4D8C 0%, #2563c4 100%)' }}
              >
                {loading
                  ? 'Calculating…'
                  : isMultiOrder
                    ? `Calculate Container (${orders.length} orders, ${totalLines} line${totalLines === 1 ? '' : 's'} total)`
                    : `Calculate Container (${totalLines} line${totalLines > 1 ? 's' : ''})`}
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
            <ContainerSummaryCard result={result} customerName={displayName} orderRef={displayRef} />
            <ContainerFloorPlan pallets={result.pallets} />
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
