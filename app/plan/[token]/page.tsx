import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import ContainerSummaryCard from '@/components/calculator/ContainerSummaryCard';
import ContainerViewTabs from '@/components/calculator/ContainerViewTabs';
import PalletPlanTable from '@/components/calculator/PalletPlanTable';
import { db } from '@/lib/db';
import { calculations } from '@/lib/db/schema';
import { isShareToken } from '@/lib/db/shareToken';
import { formatSavedAt } from '@/lib/format';
import { ShipmentResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Reachable by anyone with the link, but it shouldn't turn up in search results
export const metadata: Metadata = {
  title: 'Container Load Plan — SLEKA Industries',
  robots: { index: false, follow: false },
};

// Public read-only view of a saved plan: no edit controls, and only the fields
// shown here are sent to the browser
export default async function PublicPlanPage({ params }: { params: { token: string } }) {
  const { token } = params;

  const [row] = isShareToken(token)
    ? await db
        .select({
          id: calculations.id,
          customerName: calculations.customerName,
          orderRef: calculations.orderRef,
          resultJson: calculations.resultJson,
          createdAt: calculations.createdAt,
        })
        .from(calculations)
        .where(eq(calculations.shareToken, token))
        .limit(1)
    : [];

  if (!row) notFound();

  const result: ShipmentResult = JSON.parse(row.resultJson);
  const isConsolidated = (result.perCustomer?.length ?? 0) > 1;

  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #f8faff 100%)' }}
    >
      <div
        className="px-4 sm:px-6 py-4"
        style={{ background: 'linear-gradient(90deg, #1E4D8C 0%, #1a3f74 100%)' }}
      >
        <h1 className="text-xl font-semibold text-white">Container Load Plan #{row.id}</h1>
        <p className="text-sm text-blue-200 mt-0.5">SLEKA Industries · Export Operations</p>
      </div>

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {isConsolidated ? 'Customers' : 'Customer'}
              </p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{row.customerName || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {isConsolidated ? 'Order Refs' : 'Order Ref'}
              </p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{row.orderRef || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Saved</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{formatSavedAt(row.createdAt)}</p>
            </div>
          </div>
        </div>

        <ContainerSummaryCard
          result={result}
          customerName={isConsolidated ? '' : row.customerName}
          orderRef={isConsolidated ? '' : row.orderRef}
        />
        {/* Opens on the 3D tab: that's what the PDF's QR code promises */}
        <ContainerViewTabs
          pallets={result.pallets}
          recommendation={result.containerRecommendation}
          placed={result.placed}
          initialTab="3d"
        />
        <PalletPlanTable pallets={result.pallets} />
      </div>

      <footer className="py-6 text-center text-xs text-gray-400">
        SLEKA Industries Pvt. Ltd. · Container Load Planning System
      </footer>
    </main>
  );
}
