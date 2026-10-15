'use client';

import { useState } from 'react';
import { OrderItem } from '@/lib/types';
import { PUMP_PALLET_WIDTH } from '@/lib/constants';
import { Trash2, Plus } from 'lucide-react';

interface Props {
  items: OrderItem[];
  setItems: (items: OrderItem[]) => void;
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

export default function OrderItemForm({ setItems }: Props) {
  const [rows, setRows] = useState<OrderItem[]>([emptyRow() as OrderItem]);

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
    setRows(updated);
  }

  function addRow() {
    setRows([...rows, emptyRow() as OrderItem]);
  }

  function removeRow(index: number) {
    const updated = rows.filter((_, i) => i !== index);
    setRows(updated);
    setItems(updated.filter(isComplete));
  }

  function isComplete(row: OrderItem): boolean {
    return (
      row.productCode.trim() !== '' &&
      row.quantity > 0 &&
      row.boxLengthMm > 0 &&
      row.boxWidthMm > 0 &&
      row.boxHeightMm > 0 &&
      row.grossWeightKg > 0
    );
  }

  function handleBlur() {
    setItems(rows.filter(isComplete));
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
              <th className="text-left pb-2 pr-2 font-medium">Product Code</th>
              <th className="text-left pb-2 pr-2 font-medium">Type</th>
              <th className="text-left pb-2 pr-2 font-medium">Family</th>
              <th className="text-left pb-2 pr-2 font-medium w-16">Qty</th>
              <th className="text-left pb-2 pr-2 font-medium w-20">L (mm)</th>
              <th className="text-left pb-2 pr-2 font-medium w-20">W (mm)</th>
              <th className="text-left pb-2 pr-2 font-medium w-20">H (mm)</th>
              <th className="text-left pb-2 pr-2 font-medium w-24">Net (kg)</th>
              <th className="text-left pb-2 pr-2 font-medium w-24">Gross (kg)</th>
              <th className="pb-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, i) => (
              <tr key={i} className={isComplete(row) ? 'bg-green-50/30' : ''}>
                <td className="py-2 pr-2">
                  <input
                    type="text"
                    value={row.productCode}
                    onChange={e => updateRow(i, 'productCode', e.target.value)}
                    onBlur={handleBlur}
                    placeholder="SK77-50-NK80X65…"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-[140px]"
                  />
                </td>
                <td className="py-2 pr-2">
                  <select
                    value={row.productType}
                    onChange={e => { updateRow(i, 'productType', e.target.value); handleBlur(); }}
                    className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    {PRODUCT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <select
                    value={row.palletFamily}
                    onChange={e => { updateRow(i, 'palletFamily', e.target.value); handleBlur(); }}
                    className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    {getFamilyOptions(row.productType).map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </td>
                {(['quantity', 'boxLengthMm', 'boxWidthMm', 'boxHeightMm', 'netWeightKg', 'grossWeightKg'] as const).map(field => (
                  <td key={field} className="py-2 pr-2">
                    <input
                      type="number"
                      value={row[field] === 0 ? '' : row[field]}
                      onChange={e => updateRow(i, field, parseFloat(e.target.value) || 0)}
                      onBlur={handleBlur}
                      min={0}
                      placeholder="0"
                      className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </td>
                ))}
                <td className="py-2">
                  <button
                    onClick={() => removeRow(i)}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
