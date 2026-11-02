'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { OrderItem } from '@/lib/types';
import { PUMP_PALLET_WIDTH } from '@/lib/constants';
import { calcPumpBox, isValidStages, stageSeriesFor, MIN_STAGES, MAX_STAGES } from '@/lib/engine/pumpStageData';
import { calcMotorBox, parseMotorCode } from '@/lib/engine/motorData';
import { Trash2, Plus, FileSpreadsheet, X } from 'lucide-react';

interface Props {
  // Called synchronously with the full rows array on every change, so the
  // parent always holds the latest rows when Calculate is clicked
  onRowsChange: (rows: OrderItem[]) => void;
  // Rows to start with (e.g. a saved calculation being edited); read on mount only.
  // The parent already knows these, so onRowsChange is not called for them.
  initialRows?: OrderItem[];
  // Called with the Customer Name and Order Reference read from an imported
  // Excel file (only the values the file has; blank cells are left out)
  onImportDetails?: (details: { customerName?: string; orderRef?: string }) => void;
}

const PRODUCT_TYPES = [
  { value: 'pump', label: 'Pump' },
  { value: 'motor-V4', label: 'Motor V4 (3–7.5HP)' },
  { value: 'motor-V6', label: 'Motor V6 (≥10HP)' },
  { value: 'motor-V8', label: 'Motor V8' },
  { value: 'controller', label: 'Controller' },
  { value: 'spare', label: 'Spare Part' },
] as const;

// Pallet family options depend on product type
function getFamilyOptions(productType: OrderItem['productType']): string[] {
  if (productType === 'motor-V4') return ['SM-V4'];
  if (productType === 'motor-V6') return ['SM-V6'];
  if (productType === 'motor-V8') return ['SM-V8'];
  if (productType === 'controller') return ['controller'];
  if (productType === 'spare') return ['spare'];
  return Object.keys(PUMP_PALLET_WIDTH);
}

const NUMBER_FIELDS: { field: 'quantity' | 'boxLengthMm' | 'boxWidthMm' | 'boxHeightMm' | 'netWeightKg' | 'grossWeightKg'; label: string; className?: string }[] = [
  { field: 'quantity', label: 'Qty' },
  { field: 'boxLengthMm', label: 'L (mm)' },
  { field: 'boxWidthMm', label: 'W (mm)' },
  { field: 'boxHeightMm', label: 'H (mm)' },
  // Net weight is optional, so it is hidden on small screens
  { field: 'netWeightKg', label: 'Net kg/box', className: 'hidden md:block' },
  { field: 'grossWeightKg', label: 'Gross kg/box' },
];

// Shared column layout for the heading row and each product row:
// wraps to 2 / 4 columns on small screens, single line of fractional columns on large screens
const ROW_COLS =
  'grid-cols-2 sm:grid-cols-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.1fr)_repeat(6,minmax(0,1fr))_1.5rem] gap-2';

const FIELD_LABEL = 'block lg:hidden text-[11px] text-gray-500 uppercase tracking-wide mb-0.5';
// Stage rows replace the L/W/H/Net columns, so their labels show on every screen
const STAGE_LABEL = 'block text-[11px] text-gray-500 uppercase tracking-wide mb-0.5';
const INPUT =
  'w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';

const emptyRow = (): Omit<OrderItem, 'palletFamily'> & { palletFamily: string } => ({
  productCode: '',
  productType: 'pump',
  palletFamily: Object.keys(PUMP_PALLET_WIDTH)[0],
  quantity: 1,
  boxLengthMm: 0,
  boxWidthMm: 0,
  boxHeightMm: 0,
  netWeightKg: 0,
  grossWeightKg: 0,
});

// Stage families: box size and net weight follow the stage count. Without a
// valid count they are cleared, so the line stays incomplete until it is entered.
// Other families drop any stage count and keep their manual values.
function applyStages(row: OrderItem): OrderItem {
  const series = stageSeriesFor(row.palletFamily);
  if (!series) return { ...row, stages: undefined };
  const box = isValidStages(row.stages) ? calcPumpBox(series, row.stages) : null;
  return {
    ...row,
    boxLengthMm: box?.L ?? 0,
    boxWidthMm: box?.W ?? 0,
    boxHeightMm: box?.H ?? 0,
    netWeightKg: box?.netKg ?? 0,
    // Gross stays editable: filled only when a box is calculated, never cleared
    grossWeightKg: box?.grossKg ?? row.grossWeightKg,
  };
}

// Pump families whose stage count can be read from the item code
const PARSE_FAMILIES = ['SK09', 'SK12', 'SK13', 'SK14', 'SK17', 'SK30', 'SK46', 'SK60', 'SK60B', 'SK77'];

// Fills the line from its item code: a motor code (SM-…) or a pump code (SK…).
// Returns null, leaving the row as it is, when the code isn't recognised.
function parseItemCode(row: OrderItem): OrderItem | null {
  return parseMotorItem(row) ?? parsePumpItem(row);
}

// Motor codes give material, HP and size, e.g. SM-C-I-10-V4-50. Sets the motor
// type for that size, and box + weights from the motor table (null when that
// motor isn't in the table yet). Works from any type, so the coordinator can
// paste a motor code without changing Type first.
function parseMotorItem(row: OrderItem): OrderItem | null {
  const motor = parseMotorCode(row.productCode);
  if (!motor) return null;
  const box = calcMotorBox(motor.material, motor.size, motor.hp);
  if (!box) return null;
  const productType = `motor-${motor.size}` as const;
  return {
    ...row,
    productType,
    palletFamily: getFamilyOptions(productType)[0],
    stages: undefined,
    boxLengthMm: box.L,
    boxWidthMm: box.W,
    boxHeightMm: box.H,
    netWeightKg: box.netKg,
    grossWeightKg: box.grossKg,
  };
}

// Pump series that are physically the same pump as another series (same box
// and weights), so they resolve to that series
const PUMP_SERIES_ALIAS: Record<string, string> = { SK95: 'SK77', SK13: 'SK12', SK14: 'SK12' };

// Series and stages from a pump item code: family then stages, e.g.
// SK17-07-NK6X6-25BC-1N32-2. Also accepts a hyphen after SK (SK-95-04-…).
// Returns null when the code doesn't name a known pump family.
function pumpCodeParts(code: string): { series: string; stagesPart: string } | null {
  const m = code.trim().toUpperCase().match(/^SK-?(\d+[A-Z]?)(?:-(\d+))?(?:-|$)/);
  if (!m) return null;
  const raw = `SK${m[1]}`;
  const series = PUMP_SERIES_ALIAS[raw] ?? raw;
  const known = series === 'SK09' || series in PUMP_PALLET_WIDTH;
  return known ? { series, stagesPart: m[2] ?? '' } : null;
}

// Why a line's box isn't filled from its code, or null when it is (or the
// code is empty). Shown under the code so a line is never silently left out.
export function codeWarning(row: OrderItem): string | null {
  if (!row.productCode.trim() || isComplete(row)) return null;
  if (row.productType.startsWith('motor-') || parseMotorCode(row.productCode)) {
    return parseMotorItem(row) ? null : 'Motor not in the size table — enter box and weights by hand.';
  }
  if (row.productType !== 'pump') return null;
  const parts = pumpCodeParts(row.productCode);
  if (!parts) return 'Unknown pump family — this line is skipped until you choose a Family and enter the box.';
  if (!PARSE_FAMILIES.includes(parts.series)) {
    return `No size formula for ${parts.series} — enter box L/W/H and gross weight by hand.`;
  }
  const stages = Number(parts.stagesPart);
  if (parts.stagesPart && !isValidStages(stages) && row.stages === undefined) {
    return `${stages} stages is outside ${MIN_STAGES}–${MAX_STAGES} — check the code, or enter Stages by hand.`;
  }
  return null;
}

// Fills Family and Stages (and so the box) from the code. Families without a
// stage formula (e.g. SK05) get only their Family; the box stays manual.
// Returns null unless the line is a pump with a known family.
function parsePumpItem(row: OrderItem): OrderItem | null {
  if (row.productType !== 'pump') return null;
  const parts = pumpCodeParts(row.productCode);
  if (!parts) return null;
  const { series, stagesPart } = parts;
  if (!PARSE_FAMILIES.includes(series)) {
    return series === row.palletFamily ? null : applyStages({ ...row, palletFamily: series });
  }
  if (!/^\d+$/.test(stagesPart)) return null;
  const stages = parseInt(stagesPart, 10);
  if (!isValidStages(stages)) return null;

  // SK09 is split into size families: keep the one chosen, else the first listed
  const palletFamily = series !== 'SK09'
    ? series
    : row.palletFamily.startsWith('SK09-')
      ? row.palletFamily
      : getFamilyOptions('pump').find(f => f.startsWith('SK09-'));
  if (!palletFamily) return null;
  return applyStages({ ...row, palletFamily, stages });
}

// True when the code filled the box (motor table or stage formula), not only the Family
function boxFromCode(row: OrderItem): boolean {
  return row.productType.startsWith('motor-') || stageSeriesFor(row.palletFamily) !== null;
}

// Quantity is a whole number of boxes. A decimal is kept as typed (not silently
// rounded) and the row stays incomplete, so it never reaches the API.
function isWholeQty(row: OrderItem): boolean {
  return Number.isInteger(row.quantity);
}

export function isComplete(row: OrderItem): boolean {
  return (
    row.productCode.trim() !== '' &&
    isWholeQty(row) &&
    row.quantity > 0 &&
    row.boxLengthMm > 0 &&
    row.boxWidthMm > 0 &&
    row.boxHeightMm > 0 &&
    row.grossWeightKg > 0
  );
}

interface ImportResult {
  rows: OrderItem[];
  skipped: string[];
}

// Builds lines from imported (code, qty) pairs exactly as if each code had been
// pasted into a new line. A line whose box can't be filled from its code, or
// whose quantity isn't a whole number above 0, is skipped with a reason.
function linesFromImport(entries: { code: string; qty: number; sheetRow: number }[]): ImportResult {
  const rows: OrderItem[] = [];
  const skipped: string[] = [];
  for (const { code, qty, sheetRow } of entries) {
    const row = { ...emptyRow(), productCode: code, quantity: qty } as OrderItem;
    const parsed = parseItemCode(row) ?? row;
    if (!Number.isInteger(qty) || qty <= 0) {
      skipped.push(`Row ${sheetRow}: ${code} — quantity "${qty}" isn't a whole number above 0`);
    } else if (!isComplete(parsed)) {
      skipped.push(`Row ${sheetRow}: ${code} — ${codeWarning(parsed) ?? 'not recognised'}`);
    } else {
      rows.push(parsed);
    }
  }
  return { rows, skipped };
}

interface ImportSheet {
  customerName: string;
  orderRef: string;
  entries: { code: string; qty: number; sheetRow: number }[];
}

// Reads the "Import" sheet: Customer Name in B1, Order Reference in B2, the
// PRODUCT CODE | QTY header in row 3, then product lines (code in A, qty in B)
// from row 4, skipping blank rows. Runs in the browser; the file is never
// uploaded. SheetJS is loaded only when a file is imported.
async function readImportSheet(file: File): Promise<ImportSheet> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetName = workbook.SheetNames.find(n => n.trim().toLowerCase() === 'import');
  if (!sheetName) throw new Error('No sheet named "Import" in this file.');
  const cells = XLSX.utils.sheet_to_json<(string | number | null)[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: true,
  });
  const cell = (row: number, col: number) => String(cells[row]?.[col] ?? '').trim();
  if (cell(2, 0).toUpperCase() !== 'PRODUCT CODE') {
    throw new Error('Expected the PRODUCT CODE | QTY header in row 3 of the Import sheet.');
  }
  const entries = cells
    .map((cols, i) => ({
      code: String(cols[0] ?? '').trim(),
      qty: typeof cols[1] === 'number' ? cols[1] : Number(String(cols[1] ?? '').trim()),
      sheetRow: i + 1,
    }))
    .slice(3)
    .filter(entry => entry.code !== '');
  return { customerName: cell(0, 1), orderRef: cell(1, 1), entries };
}

export default function OrderItemForm({ onRowsChange, initialRows, onImportDetails }: Props) {
  const [rows, setRows] = useState<OrderItem[]>(() =>
    initialRows?.length ? initialRows : [emptyRow() as OrderItem]
  );

  // Every row change goes through here so the parent is told immediately
  function commitRows(updated: OrderItem[]) {
    onRowsChange(updated);
    setRows(updated);
  }

  function updateRow(index: number, field: keyof OrderItem, value: string | number | undefined) {
    const updated = [...rows];
    // If product type changes, reset pallet family to first valid option
    if (field === 'productType') {
      const newType = value as OrderItem['productType'];
      updated[index] = {
        ...updated[index],
        productType: newType,
        palletFamily: getFamilyOptions(newType)[0],
      };
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    const refilled = field === 'productType' || field === 'palletFamily' || field === 'stages';
    if (refilled) updated[index] = applyStages(updated[index]);
    commitRows(updated);
    // Stage box calculated: gross was auto-filled
    if (refilled && stageSeriesFor(updated[index].palletFamily) && isValidStages(updated[index].stages)) {
      flashAutoFilled(index, false);
    }
  }

  // Item code auto-parse. A paste is parsed in the onChange that carries the
  // pasted text (so code and parsed fields are committed together); typing is
  // parsed on blur, only if the code changed while focused, so blurring never
  // undoes a Family/Stages the coordinator overrode by hand.
  const pastedRow = useRef<number | null>(null);
  const codeOnFocus = useRef('');
  // Row whose auto-filled fields are highlighted: Gross always, Stages too when
  // it came from the item code (not when the coordinator typed it)
  const [flash, setFlash] = useState<{ row: number; stages: boolean } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // Yellow background, then a 1.5s fade back (the fade is the transition
  // that runs when the highlight class is removed)
  function flashAutoFilled(index: number, stages: boolean) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ row: index, stages });
    flashTimer.current = setTimeout(() => setFlash(null), 300);
  }
  const flashClass = (on: boolean) => (on ? 'bg-yellow-200' : 'transition-colors duration-[1500ms]');

  function changeProductCode(index: number, code: string) {
    const pasted = pastedRow.current === index;
    pastedRow.current = null;
    const row = { ...rows[index], productCode: code };
    const parsed = pasted ? parseItemCode(row) : null;
    if (parsed) codeOnFocus.current = code; // already parsed; don't redo on blur
    commitRows(rows.map((r, i) => (i === index ? parsed ?? row : r)));
    if (parsed && boxFromCode(parsed)) flashAutoFilled(index, parsed.stages !== undefined);
  }

  function blurProductCode(index: number) {
    if (rows[index].productCode === codeOnFocus.current) return;
    const parsed = parseItemCode(rows[index]);
    if (!parsed) return;
    commitRows(rows.map((r, i) => (i === index ? parsed : r)));
    if (boxFromCode(parsed)) flashAutoFilled(index, parsed.stages !== undefined);
  }

  // Focus a row's Product Code field. A just-added row isn't in the DOM yet, so
  // addRow records the index and the effect below focuses it after render.
  const listRef = useRef<HTMLDivElement>(null);
  const pendingFocusRow = useRef<number | null>(null);

  function focusProductCode(index: number) {
    listRef.current
      ?.querySelector<HTMLInputElement>(`input[data-row="${index}"][data-field="productCode"]`)
      ?.focus();
  }

  useEffect(() => {
    if (pendingFocusRow.current === null) return;
    listRef.current
      ?.querySelector<HTMLInputElement>(`input[data-row="${pendingFocusRow.current}"][data-field="productCode"]`)
      ?.focus();
    pendingFocusRow.current = null;
  }, [rows.length]);

  function addRow() {
    pendingFocusRow.current = rows.length;
    commitRows([...rows, emptyRow() as OrderItem]);
  }

  // Enter moves on without reaching for the mouse: on the last line it adds a
  // new line, on any other line it jumps to the next line's Product Code
  function handleEnter(e: KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (index === rows.length - 1) addRow();
    else focusProductCode(index + 1);
  }

  function removeRow(index: number) {
    commitRows(rows.filter((_, i) => i !== index));
  }

  // Excel import: imported lines replace blank lines and are added after the rest
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<{ added: number; skipped: string[]; error?: string } | null>(null);

  async function importFile(file: File) {
    setImporting(true);
    setImportNotice(null);
    try {
      const sheet = await readImportSheet(file);
      onImportDetails?.({
        ...(sheet.customerName && { customerName: sheet.customerName }),
        ...(sheet.orderRef && { orderRef: sheet.orderRef }),
      });
      const { rows: imported, skipped } = linesFromImport(sheet.entries);
      if (imported.length > 0) {
        commitRows([...rows.filter(r => r.productCode.trim() !== ''), ...imported]);
      }
      setImportNotice({ added: imported.length, skipped });
    } catch (e) {
      setImportNotice({ added: 0, skipped: [], error: e instanceof Error ? e.message : 'Could not read this file.' });
    } finally {
      setImporting(false);
    }
  }

  const completedCount = rows.filter(isComplete).length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6">
      <div className="flex items-center gap-6 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Product Lines</h2>
          {completedCount > 0 && (
            <p className="text-xs text-green-600 mt-0.5">{completedCount} of {rows.length} lines complete</p>
          )}
        </div>
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          <Plus size={15} /> Add Line
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={importing}
          className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
        >
          <FileSpreadsheet size={15} /> {importing ? 'Importing…' : 'Import Excel'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = ''; // the same file can be picked again
            if (file) void importFile(file);
          }}
        />
      </div>

      {importNotice && (
        <div
          role="status"
          className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
            importNotice.error || importNotice.added === 0
              ? 'border-red-200 bg-red-50 text-red-700'
              : importNotice.skipped.length > 0
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-green-200 bg-green-50 text-green-700'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium">
              {importNotice.error
                ? `Import failed: ${importNotice.error}`
                : `${importNotice.added} item${importNotice.added === 1 ? '' : 's'} imported successfully` +
                  (importNotice.skipped.length > 0 ? ` · ${importNotice.skipped.length} skipped` : '')}
            </p>
            <button onClick={() => setImportNotice(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
          {importNotice.skipped.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs space-y-0.5">
              {importNotice.skipped.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Column headings — only on wide screens; narrower screens show a label per field */}
      <div className={`hidden lg:grid ${ROW_COLS} text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100 pb-2`}>
        <span className="font-medium">Product Code</span>
        <span className="font-medium">Type</span>
        <span className="font-medium">Family</span>
        {NUMBER_FIELDS.map(f => (
          <span key={f.field} className={`font-medium ${f.className ?? ''}`}>{f.label}</span>
        ))}
        <span />
      </div>

      <div ref={listRef} className="space-y-3 lg:space-y-0 lg:divide-y lg:divide-gray-50">
        {rows.map((row, i) => (
          <div
            key={i}
            className={`grid ${ROW_COLS} items-end rounded-lg border border-gray-100 p-3 lg:rounded-none lg:border-0 lg:px-0 lg:py-2 ${isComplete(row) ? 'bg-green-50/30' : ''}`}
          >
            <div className="col-span-2 sm:col-span-4 lg:col-span-1">
              <label className={FIELD_LABEL}>Product Code</label>
              <input
                type="text"
                value={row.productCode}
                onChange={e => changeProductCode(i, e.target.value)}
                onPaste={() => { pastedRow.current = i; }}
                onFocus={e => { codeOnFocus.current = e.target.value; }}
                onBlur={() => blurProductCode(i)}
                onKeyDown={e => handleEnter(e, i)}
                data-row={i}
                data-field="productCode"
                placeholder="SK77-50-NK80X65…"
                className={INPUT}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>Type</label>
              <select
                value={row.productType}
                onChange={e => updateRow(i, 'productType', e.target.value)}
                className={INPUT}
              >
                {PRODUCT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={FIELD_LABEL}>Family</label>
              <select
                value={row.palletFamily}
                onChange={e => updateRow(i, 'palletFamily', e.target.value)}
                className={INPUT}
              >
                {getFamilyOptions(row.productType).map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            {NUMBER_FIELDS.map(({ field, label, className }) => {
              const series = stageSeriesFor(row.palletFamily);
              // Stage families: Stages input in the L slot, calculated box across W/H/Net
              if (series && field === 'boxLengthMm') {
                const badStages = row.stages !== undefined && !isValidStages(row.stages);
                return (
                  <div key="stages">
                    <label className={STAGE_LABEL}>Stages</label>
                    <input
                      type="number"
                      value={row.stages ?? ''}
                      onChange={e => updateRow(i, 'stages', e.target.value === '' ? undefined : Number(e.target.value))}
                      onKeyDown={e => handleEnter(e, i)}
                      min={MIN_STAGES}
                      max={MAX_STAGES}
                      step={1}
                      placeholder={`${MIN_STAGES}–${MAX_STAGES}`}
                      title={badStages ? `Stages must be a whole number from ${MIN_STAGES} to ${MAX_STAGES}` : undefined}
                      className={`${INPUT} ${badStages ? 'border-red-400 ring-1 ring-red-300' : ''} ${
                        flashClass(flash?.row === i && flash.stages)
                      }`}
                    />
                  </div>
                );
              }
              if (series && field === 'boxWidthMm') {
                const filled = row.boxLengthMm > 0;
                const summary = `${row.boxLengthMm} × ${row.boxWidthMm} × ${row.boxHeightMm} mm · ${row.netWeightKg} kg net`;
                return (
                  <div key="stageBox" className="col-span-2 lg:col-span-3">
                    <label className={STAGE_LABEL}>Box from {series} stages (L × W × H · net/box)</label>
                    <div
                      title={filled ? summary : undefined}
                      className="w-full truncate rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-mono text-gray-700"
                    >
                      {filled ? summary : <span className="font-sans text-gray-400">Enter stages</span>}
                    </div>
                  </div>
                );
              }
              if (series && (field === 'boxHeightMm' || field === 'netWeightKg')) return null;
              return (
              <div key={field} className={className}>
                <label className={FIELD_LABEL}>{label}</label>
                <input
                  type="number"
                  value={row[field] === 0 ? '' : row[field]}
                  onChange={e => updateRow(i, field, parseFloat(e.target.value) || 0)}
                  onKeyDown={e => handleEnter(e, i)}
                  min={0}
                  step={field === 'quantity' ? 1 : 'any'}
                  placeholder="0"
                  title={field === 'quantity' && !isWholeQty(row) ? 'Quantity must be a whole number' : undefined}
                  className={`${INPUT} ${field === 'quantity' && !isWholeQty(row) ? 'border-red-400 ring-1 ring-red-300' : ''} ${
                    field === 'grossWeightKg' ? flashClass(flash?.row === i) : ''
                  }`}
                />
              </div>
              );
            })}
            <div className="flex justify-end lg:justify-center pb-1">
              <button
                onClick={() => removeRow(i)}
                aria-label="Remove line"
                className="text-gray-300 hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
            {codeWarning(row) && (
              <p className="col-span-full text-xs text-amber-700">⚠ {row.productCode.trim()}: {codeWarning(row)}</p>
            )}
          </div>
        ))}
      </div>

      {/* Second Add Line button right under the last line, so long orders don't
          need a scroll back up to the header */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-colors"
        >
          <Plus size={15} /> Add Line
        </button>
        <span className="text-xs text-gray-400">or press Enter in the last line</span>
      </div>
    </div>
  );
}
