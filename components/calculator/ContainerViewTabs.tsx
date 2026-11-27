'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ContainerFloorPlan from '@/components/calculator/ContainerFloorPlan';
import Container3DView from '@/components/calculator/Container3DView';
import PdfSideView from '@/components/calculator/PdfSideView';
import { applyPositions, floorLayout } from '@/lib/engine/floorPlan';
import { PalletPlan, PalletPositions, PlacedPallet, ShipmentResult } from '@/lib/types';

type Tab = 'plan' | '3d';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'plan', label: 'Floor Plan' },
  { id: '3d', label: '3D View' },
];

interface Props {
  pallets: PalletPlan[];
  recommendation: ShipmentResult['containerRecommendation'];
  placed?: PlacedPallet[];
  initialTab?: Tab;
  // Editor mode (dashboard): the floor plan is a collapsible editor above an
  // always-visible 3D view, and both draw the hand-set positions
  positions?: PalletPositions;
  onPositionsChange?: (positions: PalletPositions) => void;
  maxPalletGrossKg?: number;
}

export default function ContainerViewTabs(props: Props) {
  return props.onPositionsChange ? <EditorLayout {...props} /> : <ReadOnlyTabs {...props} />;
}

// Floor plan and 3D view of the same result. Both stay mounted once opened, so
// the floor plan keeps its Top/Side choice and the 3D view keeps its camera.
function ReadOnlyTabs({ initialTab = 'plan', pallets, recommendation, placed }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // The 3D scene isn't created until its tab is first opened
  const [opened3d, setOpened3d] = useState(initialTab === '3d');
  const viewProps = { pallets, recommendation, placed };

  return (
    <div>
      {/* The PDF always holds the floor plan, whichever tab is showing */}
      <div data-pdf-hide role="tablist" className="mb-3 inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              if (id === '3d') setOpened3d(true);
            }}
            className={`px-4 py-2 transition-colors ${tab === id ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* data-pdf-only: hidden on screen but still captured by the PDF export */}
      <div role="tabpanel" data-pdf-keep className={tab === 'plan' ? undefined : 'hidden'} data-pdf-only={tab === 'plan' ? undefined : true}>
        <ContainerFloorPlan {...viewProps} />
      </div>

      <PdfSideView {...viewProps} />

      {opened3d && (
        <div role="tabpanel" data-pdf-hide className={tab === '3d' ? undefined : 'hidden'}>
          <Container3DView {...viewProps} active={tab === '3d'} />
        </div>
      )}
    </div>
  );
}

// Dashboard: drag pallets in the 2D floor plan and watch the 3D view follow
function EditorLayout({ pallets, recommendation, placed, positions, onPositionsChange, maxPalletGrossKg }: Props) {
  const [planOpen, setPlanOpen] = useState(true);
  const isLcl = recommendation === 'LCL';
  // The PDF side view draws the floor as it stands, moves included
  const placedNow = useMemo(() => {
    const layout = floorLayout(pallets, recommendation, placed);
    return layout ? applyPositions(layout.placed, positions, layout.containerLength) : placed;
  }, [pallets, recommendation, placed, positions]);

  return (
    <div className="space-y-4">
      <section>
        <button
          data-pdf-hide
          onClick={() => setPlanOpen(o => !o)}
          aria-expanded={planOpen}
          aria-controls="floor-plan-editor"
          className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-900"
        >
          <ChevronDown size={14} className={`transition-transform ${planOpen ? '' : '-rotate-90'}`} />
          2D Floor Plan Editor
          {!isLcl && positions && Object.keys(positions).length > 0 && (
            <span className="ml-1 normal-case font-medium text-blue-700">· edited</span>
          )}
        </button>
        {/* Collapsed on screen, still captured by the PDF export */}
        <div
          id="floor-plan-editor"
          data-pdf-keep
          className={planOpen ? undefined : 'hidden'}
          data-pdf-only={planOpen ? undefined : true}
        >
          <ContainerFloorPlan
            pallets={pallets}
            recommendation={recommendation}
            placed={placed}
            positions={positions}
            onPositionsChange={onPositionsChange}
            maxPalletGrossKg={maxPalletGrossKg}
          />
        </div>
      </section>

      <PdfSideView pallets={pallets} recommendation={recommendation} placed={placedNow} />

      <div data-pdf-hide>
        <Container3DView
          pallets={pallets}
          recommendation={recommendation}
          placed={placed}
          palletPositions={positions}
          active
        />
      </div>
    </div>
  );
}
