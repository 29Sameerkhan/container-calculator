import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import ContainerSummaryCard from '@/components/calculator/ContainerSummaryCard';
import ContainerViewTabs from '@/components/calculator/ContainerViewTabs';
import PalletPlanTable from '@/components/calculator/PalletPlanTable';
import { db } from '@/lib/db';
import { calculations } from '@/lib/db/schema';
import { isShareToken } from '@/lib/db/shareToken';
import { formatSavedAt } from '@/lib/format';
import { RulePreset, ShipmentResult } from '@/lib/types';
import { DEFAULT_PRESET, isRulePreset, PRESET_CONFIGS, PRESET_LABELS, PRESET_SUMMARIES, RULE_PRESETS } from '@/lib/constants';
import { computeShipment } from '@/lib/engine/palletEngine';
import { engineItems, savedOrderList } from '@/lib/orders';

export const dynamic = 'force-dynamic';

// Reachable by anyone with the link, but it shouldn't turn up in search results
export const metadata: Metadata = {
  title: 'Container Load Plan — SLEKA Industries',
  robots: { index: false, follow: false },
};

// Public read-only view of a saved plan: no edit controls, and only the fields
// shown here are sent to the browser. ?preset=standard|relaxed|freepack (the PDF's
// per-preset links) shows the plan under those rules: the saved result for the
// preset it was saved with, otherwise recalculated here from the saved order lines.
export default async function PublicPlanPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { preset?: string | string[] };
}) {
  const { token } = params;

  const [row] = isShareToken(token)
    ? await db
        .select({
          id: calculations.id,
          customerName: calculations.customerName,
          orderRef: calculations.orderRef,
          itemsJson: calculations.itemsJson,
          resultJson: calculations.resultJson,
          createdAt: calculations.createdAt,
        })
        .from(calculations)
        .where(eq(calculations.shareToken, token))
        .limit(1)
    : [];

  if (!row) notFound();

  const saved: ShipmentResult = JSON.parse(row.resultJson);
  // Results saved before presets existed were packed with the Standard rules
  const savedPreset: RulePreset = saved.preset ?? DEFAULT_PRESET;
  const asked = searchParams.preset;
  const preset: RulePreset = isRulePreset(asked) ? asked : savedPreset;
  let result = saved;
  let presetError: string | null = null;
  if (preset !== savedPreset) {
    try {
      const orders = savedOrderList(JSON.parse(row.itemsJson), row.customerName, row.orderRef);
      result = computeShipment(engineItems(orders), PRESET_CONFIGS[preset], preset);
    } catch (e) {
      presetError = e instanceof Error ? e.message : 'Calculation failed';
    }
  }
  // The preset whose plan is on show (the saved one if the asked-for one failed)
  const shown: RulePreset = presetError ? savedPreset : preset;
  const isConsolidated = (saved.perCustomer?.length ?? 0) > 1;

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

        {/* Packing rules: read-only switch between presets (links, no editing) */}
        <nav aria-label="Packing rules" className="bg-white rounded-2xl shadow-sm border border-blue-100 px-6 py-4">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm font-semibold text-gray-700">Packing Rules:</span>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
              {RULE_PRESETS.map((p, i) => (
                <Link
                  key={p}
                  href={`/plan/${token}?preset=${p}`}
                  aria-current={p === shown ? 'page' : undefined}
                  scroll={false}
                  className={`px-4 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
                    p === shown ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {PRESET_LABELS[p]}
                  {p === savedPreset && <span className="sr-only"> (saved)</span>}
                </Link>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {PRESET_SUMMARIES[shown]}
            {shown !== savedPreset && ` · Saved with ${PRESET_LABELS[savedPreset]}; recalculated with these rules`}
          </p>
          {presetError && (
            <p className="mt-2 text-sm text-red-600">
              Could not calculate {PRESET_LABELS[preset]} for this plan ({presetError}). Showing the saved {PRESET_LABELS[savedPreset]} plan.
            </p>
          )}
        </nav>

        <ContainerSummaryCard
          result={result}
          customerName={isConsolidated ? '' : row.customerName}
          orderRef={isConsolidated ? '' : row.orderRef}
        />
        {/* Opens on the 3D tab: that's what the PDF's QR code promises */}
        <ContainerViewTabs
          key={shown}
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
