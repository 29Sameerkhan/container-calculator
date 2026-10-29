'use client';

import { ReactNode } from 'react';
import { OrderItem, ShipmentOrder } from '@/lib/types';

// Parts of the plan that only appear in the downloaded PDF: a company header
// and the product lines the plan was calculated from. They are hidden on
// screen and shown when the PDF is captured (see exportPlanPdf).

const PRODUCT_TYPE_LABEL: Record<OrderItem['productType'], string> = {
  pump: 'Pump',
  'motor-V4': 'Motor V4',
  'motor-V6': 'Motor V6',
  'motor-V8': 'Motor V8',
  controller: 'Controller',
  spare: 'Spare',
};

function PdfOnly({ children }: { children: ReactNode }) {
  return <div data-pdf-only className="hidden">{children}</div>;
}

export function PdfCompanyHeader({ planId, date }: { planId: number | null; date: string }) {
  return (
    <PdfOnly>
      <div
        className="rounded-2xl px-6 py-4 flex items-center justify-between"
        style={{ background: 'linear-gradient(90deg, #1E4D8C 0%, #1a3f74 100%)' }}
      >
        <div>
          <p className="text-lg font-semibold text-white">SLEKA Industries Pvt. Ltd.</p>
          <p className="text-sm text-blue-200 mt-0.5">Container Load Plan · Export Operations</p>
        </div>
        <div className="text-right text-sm text-blue-100">
          {planId !== null && <p className="font-semibold text-white">Plan #{planId}</p>}
          <p>{date}</p>
        </div>
      </div>
    </PdfOnly>
  );
}

export function PdfOrderLines({ orders }: { orders: ShipmentOrder[] }) {
  return (
    <PdfOnly>
      <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Product Entries</h2>
        {orders.map((order, i) => (
          <div key={i} className="space-y-2">
            {(orders.length > 1 || order.customerName || order.orderRef) && (
              <p className="text-sm font-semibold text-gray-800">
                {orders.length > 1 && `Order ${i + 1}`}
                {order.customerName && `${orders.length > 1 ? ' — ' : ''}${order.customerName}`}
                {order.orderRef && <span className="font-normal text-gray-500"> · {order.orderRef}</span>}
              </p>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 uppercase tracking-wide border-b border-blue-100">
                  <th className="text-left py-2 pr-3 font-medium">Product Code</th>
                  <th className="text-left py-2 pr-3 font-medium">Type</th>
                  <th className="text-left py-2 pr-3 font-medium">Family</th>
                  <th className="text-right py-2 pr-3 font-medium">Qty</th>
                  <th className="text-right py-2 pr-3 font-medium">Box L × W × H (mm)</th>
                  <th className="text-right py-2 pr-3 font-medium">Net kg / box</th>
                  <th className="text-right py-2 font-medium">Gross kg / box</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {order.items.map((item, j) => (
                  <tr key={j}>
                    <td className="py-2 pr-3 font-medium text-gray-800">{item.productCode}</td>
                    <td className="py-2 pr-3 text-gray-600">{PRODUCT_TYPE_LABEL[item.productType] ?? item.productType}</td>
                    <td className="py-2 pr-3 text-gray-600">{item.palletFamily}</td>
                    <td className="py-2 pr-3 text-right">{item.quantity}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {item.boxLengthMm} × {item.boxWidthMm} × {item.boxHeightMm}
                    </td>
                    <td className="py-2 pr-3 text-right">{item.netWeightKg}</td>
                    <td className="py-2 text-right">{item.grossWeightKg}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 font-semibold text-gray-800">
                  <td className="py-2 pr-3" colSpan={3}>Total</td>
                  <td className="py-2 pr-3 text-right">{order.items.reduce((s, it) => s + it.quantity, 0)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
      </div>
    </PdfOnly>
  );
}
