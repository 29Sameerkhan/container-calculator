'use client';

import { useEffect, useState, type MutableRefObject } from 'react';
import { OrderItem } from '@/lib/types';
import { PUMP_PALLET_WIDTH } from '@/lib/constants';
import { Trash2, Plus } from 'lucide-react';

interface Props {
  items: OrderItem[];
  setItems: (items: OrderItem[]) => void;
  // Always holds the latest rows, written synchronously on every change;
  // the dashboard reads it when Calculate is clicked
  rowsRef: MutableRefObject<OrderItem[]>;
}

const PRODUCT_TYPES = [
  { value: 'pump', label: 'Pump' },
  { value: 'motor-V4', label: 'Motor V4 (3–7.5HP)' },
  { value: 'motor-V6', label: 'Motor V6 (≥10HP)' },
  { value: 'controller', label: 'Controller' },
  { value: 'spare', label: 'Spare Part' },
] as const;

// Pallet family options depend on product type
function getFamilyOptions(productType: OrderItem['productType']): string[] {
  if (productType === 'motor-V4') return ['SM-V4'];
  if (productType === 'motor-V6') return ['SM-V6'];
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

export default function OrderItemForm({ setItems, rowsRef }: Props) {
  const [rows, setRows] = useState<OrderItem[]>([emptyRow() as OrderItem]);

  // Keep the parent's items in sync for display (button visibility, line count)
  useEffect(() => {
    setItems(rows.filter(isComplete));
  }, [rows, setItems]);

  // Every row change goes through here so rowsRef is updated immediately
  function commitRows(updated: OrderItem[]) {
    rowsRef.current = updated;
    setRows(updated);
  }

  function updateRow(index: number, field: keyof OrderItem, value: string | number) {
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
    commitRows(updated);
  }

  function addRow() {
    commitRows([...rows, emptyRow() as OrderItem]);
  }

  function removeRow(index: number) {
    commitRows(rows.filter((_, i) => i !== index));
  }

  const completedCount = rows.filter(isComplete).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
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
      </div>

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

      <div className="space-y-3 lg:space-y-0 lg:divide-y lg:divide-gray-50">
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
                onChange={e => updateRow(i, 'productCode', e.target.value)}
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
            {NUMBER_FIELDS.map(({ field, label, className }) => (
              <div key={field} className={className}>
                <label className={FIELD_LABEL}>{label}</label>
                <input
                  type="number"
                  value={row[field] === 0 ? '' : row[field]}
                  onChange={e => updateRow(i, field, parseFloat(e.target.value) || 0)}
                  min={0}
                  step={field === 'quantity' ? 1 : 'any'}
                  placeholder="0"
                  title={field === 'quantity' && !isWholeQty(row) ? 'Quantity must be a whole number' : undefined}
                  className={`${INPUT} ${field === 'quantity' && !isWholeQty(row) ? 'border-red-400 ring-1 ring-red-300' : ''}`}
                />
              </div>
            ))}
            <div className="flex justify-end lg:justify-center pb-1">
              <button
                onClick={() => removeRow(i)}
                aria-label="Remove line"
                className="text-gray-300 hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
