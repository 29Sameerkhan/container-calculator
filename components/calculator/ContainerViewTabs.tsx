'use client';

import { ReactNode, useMemo } from 'react';
import ContainerFloorPlan from '@/components/calculator/ContainerFloorPlan';
import Container3DView from '@/components/calculator/Container3DView';
import PdfSideView from '@/components/calculator/PdfSideView';
import PalletPlanTable from '@/components/calculator/PalletPlanTable';
import { applyPositions, floorLayout, withStackFields } from '@/lib/engine/floorPlan';
import { PalletPlan, PalletPositions, PlacedPallet, ShipmentResult } from '@/lib/types';

interface Props {
  pallets: PalletPlan[];
  recommendation: ShipmentResult['containerRecommendation'];
  placed?: PlacedPallet[];
  // Editor mode (calculator): the floor plan is draggable, both views draw the
  // hand-set positions and the Pallet Table follows below
  positions?: PalletPositions;
  onPositionsChange?: (positions: PalletPositions) => void;
  maxPalletGrossKg?: number;
}

// Floor plan and 3D view side by side (stacked on phones), both always mounted
// and live: a drag on the floor plan shows up in the 3D view straight away, and
// the 3D scene is never torn down, so its camera survives every change.
export default function ContainerViewTabs({
  pallets, recommendation, placed, positions, onPositionsChange, maxPalletGrossKg,
}: Props) {
  const isEditor = !!onPositionsChange;
  const viewProps = { pallets, recommendation, placed };

  // The table lists stacks as the floor stands now, hand-made ones included
  const tablePallets = useMemo(() => {
    if (!isEditor) return pallets;
    const layout = floorLayout(pallets, recommendation, placed);
    return layout ? withStackFields(pallets, applyPositions(layout.placed, positions, layout.containerLength)) : pallets;
  }, [isEditor, pallets, recommendation, placed, positions]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {/* data-pdf-keep: the PDF export captures the floor plan */}
        <Panel label="Floor Plan" pdfKeep>
          <ContainerFloorPlan
            {...viewProps}
            positions={positions}
            onPositionsChange={onPositionsChange}
            maxPalletGrossKg={maxPalletGrossKg}
          />
        </Panel>

        <Panel label="3D View" pdfHide>
          <Container3DView {...viewProps} palletPositions={positions} active />
        </Panel>
      </div>

      {/* Hidden on screen; the PDF export adds a side view under the floor plan */}
      {!isEditor && <PdfSideView {...viewProps} />}

      {isEditor && <PalletPlanTable pallets={tablePallets} />}
    </div>
  );
}

function Panel({ label, pdfKeep, pdfHide, children }: { label: string; pdfKeep?: boolean; pdfHide?: boolean; children: ReactNode }) {
  return (
    <section aria-label={label} className="min-w-0" data-pdf-keep={pdfKeep || undefined} data-pdf-hide={pdfHide || undefined}>
      <h3 data-pdf-hide className="mb-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</h3>
      {children}
    </section>
  );
}
