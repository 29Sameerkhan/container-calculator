'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import OrderItemForm, { isComplete, codeWarning } from '@/components/calculator/OrderItemForm';
import ContainerSummaryCard from '@/components/calculator/ContainerSummaryCard';
import ContainerViewTabs from '@/components/calculator/ContainerViewTabs';
import { OrderItem, PalletPositions, RulePreset, ShipmentOrder, ShipmentResult } from '@/lib/types';
import PresetSelector from '@/components/calculator/PresetSelector';
import { DEFAULT_PRESET, isRulePreset, PRESET_CONFIGS } from '@/lib/constants';
import { applyPositions, floorLayout, validateLayout, withStackFields, withStackWarnings } from '@/lib/engine/floorPlan';
import ShareLinkButton from '@/components/calculator/ShareLinkButton';
import { exportPlanPdf, planPdfFilename, planShareUrlForPdf } from '@/lib/exportPlanPdf';
import { PdfCompanyHeader, PdfCoverDetails, PdfOrderLines } from '@/components/calculator/PdfOrderSheet';
import PdfPresetSections from '@/components/calculator/PdfPresetSections';
import { fetchAllPresetResults, PresetLinks, presetLinks, PresetResults, presetShareFooter } from '@/lib/presetResults';

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

// Single order: saved exactly as before. Multi-order: names joined for the
// history list, and the full order list kept in items so it can be reloaded.
function saveBody(calculatedOrders: ShipmentOrder[], result: ShipmentResult) {
  return calculatedOrders.length === 1
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
}

// Always saves a new record, even when working from an edited calculation
async function saveCalculation(calculatedOrders: ShipmentOrder[], result: ShipmentResult): Promise<number> {
  const res = await fetch('/api/save-calculation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(saveBody(calculatedOrders, result)),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Save failed');
  return data.id;
}

// Re-saves an already saved calculation in place (same id and share link)
async function updateCalculation(id: number, calculatedOrders: ShipmentOrder[], result: ShipmentResult): Promise<number> {
  const res = await fetch('/api/save-calculation', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...saveBody(calculatedOrders, result) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Update failed');
  return data.id;
}

async function runEngine(submitOrders: ShipmentOrder[], preset: RulePreset): Promise<ShipmentResult> {
  const res = await fetch('/api/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orders: submitOrders, preset }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'Calculation failed');
  return data.result;
}

// The result as it should be stored: hand-moved floor positions and hand-made
// stacks written into placed (and the pallets' stack fields), so history, the
// share link and the PDF all draw the edited layout. Stacks over a weight or
// height limit add their warnings to the result's list.
function withLayout(result: ShipmentResult, positions: PalletPositions): ShipmentResult {
  if (Object.keys(positions).length === 0) return result;
  const layout = floorLayout(result.pallets, result.containerRecommendation, result.placed);
  if (!layout) return result;
  const placed = applyPositions(layout.placed, positions, layout.containerLength);
  return {
    ...result,
    pallets: withStackFields(result.pallets, placed),
    placed,
    manualLayout: true,
    warnings: withStackWarnings(result.warnings, placed),
  };
}

// The result's warnings with the current floor's stack warnings, for the summary card
function liveWarnings(result: ShipmentResult, positions: PalletPositions): string[] {
  const layout = floorLayout(result.pallets, result.containerRecommendation, result.placed);
  if (!layout) return result.warnings;
  return withStackWarnings(result.warnings, applyPositions(layout.placed, positions, layout.containerLength));
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
  // Lines with a product code that weren't sent because they're incomplete
  const [skipped, setSkipped] = useState<string[]>([]);
  // Every calculation is saved to history automatically; Save downloads the PDF
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  // The results block the PDF is captured from
  const planRef = useRef<HTMLDivElement>(null);
  // The plan under all three presets, drawn into the PDF only while it is captured
  const [pdfData, setPdfData] = useState<{ results: PresetResults; links?: PresetLinks } | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  // Orders the current result was calculated from — what Save stores
  const [calculatedOrders, setCalculatedOrders] = useState<ShipmentOrder[]>([]);
  const [editBanner, setEditBanner] = useState<string | null>(null);
  // Packing rules; changing them re-runs the engine on the calculated orders
  const [preset, setPreset] = useState<RulePreset>(DEFAULT_PRESET);
  const [presetBusy, setPresetBusy] = useState(false);
  // Floor positions moved by hand in the floor plan editor, keyed by floor pallet
  const [positions, setPositions] = useState<PalletPositions>({});
  // Moves made since the result was last saved
  const [layoutDirty, setLayoutDirty] = useState(false);
  // Only the latest engine run may set the result (presets can be switched quickly)
  const runSeq = useRef(0);
  // The save in flight, so a re-save waits for it and updates the same record
  const pendingSave = useRef<Promise<number | null> | null>(null);
  const savedIdRef = useRef<number | null>(null);
  // Bumped when a new calculation starts, so a save still in flight for the old
  // one can't claim the new one's record
  const saveGen = useRef(0);
  const [bannerMode, setBannerMode] = useState<'edit' | 'duplicate' | null>(null);

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
        setPreset(isRulePreset(calc.result?.preset) ? calc.result.preset : DEFAULT_PRESET);
        setPositions({});
        setLayoutDirty(false);
        setResult(null);
        setCalculatedOrders([]);
        setError(null);
        setSaveStatus('idle');
        setSavedId(null);
        savedIdRef.current = null;
        pendingSave.current = null;
        saveGen.current++;
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

  // Saves the result to history: a new record the first time, then the same
  // record updated (so its id and share link stay the same). Returns the id, or
  // null if the save failed.
  async function persist(submitOrders: ShipmentOrder[], calculated: ShipmentResult): Promise<number | null> {
    const previous = pendingSave.current;
    const gen = saveGen.current;
    const run = (async () => {
      await previous;
      if (gen !== saveGen.current) return null;
      setSaveStatus('saving');
      try {
        const existing = savedIdRef.current;
        const id = existing
          ? await updateCalculation(existing, submitOrders, calculated)
          : await saveCalculation(submitOrders, calculated);
        if (gen !== saveGen.current) return null;
        savedIdRef.current = id;
        setSavedId(id);
        setSaveStatus('saved');
        return id;
      } catch (e) {
        console.error(e);
        if (gen === saveGen.current) setSaveStatus('error');
        return null;
      }
    })();
    pendingSave.current = run;
    return run;
  }

  async function autoSave(submitOrders: ShipmentOrder[], calculated: ShipmentResult) {
    await persist(submitOrders, calculated);
  }

  // A new preset re-runs the engine on the orders already calculated and updates
  // the saved record. Hand-moved positions belong to the old pallets, so they go.
  async function handlePresetChange(next: RulePreset) {
    setPreset(next);
    if (!result || calculatedOrders.length === 0) return;
    const seq = ++runSeq.current;
    setPresetBusy(true);
    setError(null);
    try {
      const calculated = await runEngine(calculatedOrders, next);
      if (seq !== runSeq.current) return;
      setResult(calculated);
      setPositions({});
      setLayoutDirty(false);
      setPdfStatus('idle');
      void autoSave(calculatedOrders, calculated);
    } catch (e) {
      if (seq === runSeq.current) setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      if (seq === runSeq.current) setPresetBusy(false);
    }
  }

  function handlePositionsChange(next: PalletPositions) {
    setPositions(next);
    setLayoutDirty(true);
    setPdfStatus('idle');
  }

  async function handleCalculate() {
    setSaveStatus('idle');
    setPdfStatus('idle');
    setSavedId(null);
    savedIdRef.current = null;
    pendingSave.current = null;
    saveGen.current++;
    const submitOrders: ShipmentOrder[] = orders.map(o => ({
      customerName: o.customerName,
      orderRef: o.orderRef,
      items: liveRows(o).filter(row => isComplete(row)),
    }));
    console.log('[calculate] orders being sent:', submitOrders);
    setSkipped(orders.flatMap(o => liveRows(o)
      .filter(row => row.productCode.trim() && !isComplete(row))
      .map(row => `${row.productCode.trim()} — ${codeWarning(row) ?? 'box size, quantity or gross weight missing'}`)));

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
    const seq = ++runSeq.current;
    try {
      const calculated = await runEngine(submitOrders, preset);
      if (seq !== runSeq.current) return;
      setResult(calculated);
      setCalculatedOrders(submitOrders);
      setPositions({});
      setLayoutDirty(false);
      void autoSave(submitOrders, calculated);
    } catch (e) {
      if (seq === runSeq.current) setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
      setPresetBusy(false);
    }
  }

  function handleReset() {
    rowsByOrder.current = new Map();
    setOrders([makeOrder()]);
    setCalculatedOrders([]);
    setResult(null);
    setError(null);
    setSkipped([]);
    setSaveStatus('idle');
    setPdfStatus('idle');
    setSavedId(null);
    savedIdRef.current = null;
    pendingSave.current = null;
    saveGen.current++;
    runSeq.current++;
    setPreset(DEFAULT_PRESET);
    setPresetBusy(false);
    setPositions({});
    setLayoutDirty(false);
    setEditBanner(null);
    setBannerMode(null);
    router.replace('/dashboard');
  }

  // The calculation is already in history (auto-saved); this retries the save
  // if that failed, then downloads the plan on screen as a PDF
  async function handleSave() {
    if (!result || calculatedOrders.length === 0 || !planRef.current || layoutErrors.length > 0) return;
    let id = savedId;
    // Re-save when the auto-save failed, or to store floor moves made since
    if (saveStatus !== 'saved' || layoutDirty) {
      id = await persist(calculatedOrders, withLayout(result, positions));
      if (id === null) return;
      setLayoutDirty(false);
    }
    setPdfStatus('exporting');
    try {
      // The PDF holds the plan under every preset, whichever one is selected here;
      // the current preset's section keeps any floor moves
      const [all, shareUrl] = await Promise.all([
        fetchAllPresetResults(calculatedOrders, withLayout(result, positions)),
        id ? planShareUrlForPdf(id) : Promise.resolve(undefined),
      ]);
      // Each preset section links to its own 3D page: /plan/{token}?preset=…
      const links = shareUrl ? await presetLinks(shareUrl) : undefined;
      flushSync(() => setPdfData({ results: all, links }));
      await exportPlanPdf(planRef.current, planPdfFilename(id, displayName), links && presetShareFooter(links, result.preset));
      // The form stays as it is; New Calculation clears it
      setPdfStatus('done');
    } catch (e) {
      console.error(e);
      setPdfStatus('error');
    } finally {
      setPdfData(null);
    }
  }

  // Floor plan checks for the current layout; errors block Save / Export
  const maxPalletGrossKg = PRESET_CONFIGS[result?.preset ?? preset].maxPalletGrossKg;
  const layoutErrors = useMemo(() => {
    if (!result) return [];
    const layout = floorLayout(result.pallets, result.containerRecommendation, result.placed);
    if (!layout) return [];
    const placedNow = applyPositions(layout.placed, positions, layout.containerLength);
    return validateLayout(placedNow, layout.containerLength, maxPalletGrossKg, positions).filter(i => i.severity === 'error');
  }, [result, positions, maxPalletGrossKg]);
  const saveBlockedReason = layoutErrors.length > 0
    ? `Fix ${layoutErrors.length} floor plan error${layoutErrors.length > 1 ? 's' : ''} before saving: ${layoutErrors[0].message}`
    : null;

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
              onImportDetails={({ customerName, orderRef }) => {
                if (customerName !== undefined) updateOrder(order.id, 'customerName', customerName);
                if (orderRef !== undefined) updateOrder(order.id, 'orderRef', orderRef);
              }}
            />
          </section>
        ))}

        <button
          onClick={addOrder}
          className="w-full rounded-2xl border-2 border-dashed border-blue-200 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50 hover:border-blue-300 transition-colors"
        >
          + Add Another Order
        </button>

        {/* Packing rules, always above Calculate: they apply to the next calculation
            and re-run the current one when changed */}
        <PresetSelector value={preset} onChange={p => { void handlePresetChange(p); }} busy={presetBusy} />

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
            {skipped.length > 0 && (
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <p className="font-medium">
                  {skipped.length} line{skipped.length > 1 ? 's' : ''} skipped — not included in the calculation:
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs space-y-0.5">
                  {skipped.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>
        )}

        {/* Results */}
        {result && (
          <div ref={planRef} className="space-y-4">
            <PdfCompanyHeader
              planId={savedId}
              date={new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}
            />
            <PdfCoverDetails
              customerName={displayName}
              orderRef={displayRef}
              date={new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}
            />
            {/* On screen: the selected preset. The PDF has its own section per preset. */}
            <div data-pdf-hide className="space-y-4">
              <ContainerSummaryCard
                result={{ ...result, warnings: liveWarnings(result, positions) }}
                customerName={displayName}
                orderRef={displayRef}
              />
            </div>
            <PdfOrderLines orders={calculatedOrders} />
            <div data-pdf-hide>
              <ContainerViewTabs
                pallets={result.pallets}
                recommendation={result.containerRecommendation}
                placed={result.placed}
                positions={positions}
                onPositionsChange={handlePositionsChange}
                maxPalletGrossKg={maxPalletGrossKg}
              />
            </div>
            <PdfPresetSections results={pdfData?.results ?? null} links={pdfData?.links} />
          </div>
        )}

        {result && (
          <div className="flex items-center gap-3">
            {/* A disabled button gets no hover events, so the tooltip sits on a wrapper */}
            <span title={saveBlockedReason ?? undefined} className={saveBlockedReason ? 'cursor-not-allowed' : undefined}>
            <button
              onClick={handleSave}
              disabled={!!saveBlockedReason || presetBusy || saveStatus === 'saving' || pdfStatus === 'exporting'}
              aria-describedby={saveBlockedReason ? 'save-blocked-reason' : undefined}
              className={`bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium px-6 py-2.5 rounded-xl text-sm transition-colors ${saveBlockedReason ? 'pointer-events-none' : ''}`}
            >
              {saveStatus === 'saving'
                ? 'Saving…'
                : pdfStatus === 'exporting'
                  ? 'Creating PDF…'
                  : pdfStatus === 'done'
                    ? '✓ PDF downloaded — Download again'
                    : '💾 Save Calculation & Download PDF'}
            </button>
            </span>
            {saveBlockedReason && (
              <p id="save-blocked-reason" className="text-sm text-red-600">
                Save blocked — {layoutErrors.length} floor plan error{layoutErrors.length > 1 ? 's' : ''}
              </p>
            )}
            {!saveBlockedReason && layoutDirty && (
              <p className="text-sm text-blue-700">Floor layout changed — Save to keep it in history and the share link</p>
            )}
            {saveStatus === 'saved' && savedId && (
              <>
                <p className="text-sm text-green-700">Saved to history as #{savedId}</p>
                <ShareLinkButton
                  planId={savedId}
                  className="text-sm font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-xl px-4 py-2.5 transition-colors"
                />
              </>
            )}
            {saveStatus === 'error' && (
              <p className="text-sm text-red-600">Auto-save to history failed — click Save to retry</p>
            )}
            {pdfStatus === 'error' && (
              <p className="text-sm text-red-600">PDF export failed — check console</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
