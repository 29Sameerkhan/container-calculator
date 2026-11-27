'use client';

import { useMemo, useState } from 'react';
import ContainerFloorPlan from '@/components/calculator/ContainerFloorPlan';
import Container3DView from '@/components/calculator/Container3DView';
import PdfSideView from '@/components/calculator/PdfSideView';
import PalletPlanTable from '@/components/calculator/PalletPlanTable';
import { applyPositions, floorLayout, withStackFields } from '@/lib/engine/floorPlan';
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
  // Editor mode (calculator): Floor Plan / 3D View / Pallet Table tabs; the floor
  // plan is draggable and both views draw the hand-set positions
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

type EditorTab = 'plan' | '3d' | 'table';

const EDITOR_TABS: Array<{ id: EditorTab; label: string }> = [
  { id: 'plan', label: 'Floor Plan' },
  { id: '3d', label: '3D View' },
  { id: 'table', label: 'Pallet Table' },
];

// Calculator results: Floor Plan (the drag-and-drop editor, shown first), 3D View
// (follows the moves) and Pallet Table. Panels stay mounted once opened, so the
// 3D camera and the floor plan's Top/Side choice survive switching tabs.
function EditorLayout({ pallets, recommendation, placed, positions, onPositionsChange, maxPalletGrossKg }: Props) {
  const [tab, setTab] = useState<EditorTab>('plan');
  // The 3D scene isn't created until its tab is first opened
  const [opened3d, setOpened3d] = useState(false);
  // The table lists stacks as the floor stands now, hand-made ones included
  const tablePallets = useMemo(() => {
    const layout = floorLayout(pallets, recommendation, placed);
    return layout ? withStackFields(pallets, applyPositions(layout.placed, positions, layout.containerLength)) : pallets;
  }, [pallets, recommendation, placed, positions]);

  return (
    <div>
      <div role="tablist" aria-label="Result views" className="mb-3 inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium bg-white">
        {EDITOR_TABS.map(({ id, label }, i) => (
          <button
            key={id}
            id={`result-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`result-panel-${id}`}
            onClick={() => {
              setTab(id);
              if (id === '3d') setOpened3d(true);
            }}
            className={`px-5 py-2 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
              tab === id ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div id="result-panel-plan" role="tabpanel" aria-labelledby="result-tab-plan" className={tab === 'plan' ? undefined : 'hidden'}>
        <ContainerFloorPlan
          pallets={pallets}
          recommendation={recommendation}
          placed={placed}
          positions={positions}
          onPositionsChange={onPositionsChange}
          maxPalletGrossKg={maxPalletGrossKg}
        />
      </div>

      {opened3d && (
        <div id="result-panel-3d" role="tabpanel" aria-labelledby="result-tab-3d" className={tab === '3d' ? undefined : 'hidden'}>
          <Container3DView
            pallets={pallets}
            recommendation={recommendation}
            placed={placed}
            palletPositions={positions}
            active={tab === '3d'}
          />
        </div>
      )}

      <div id="result-panel-table" role="tabpanel" aria-labelledby="result-tab-table" className={tab === 'table' ? undefined : 'hidden'}>
        <PalletPlanTable pallets={tablePallets} />
      </div>
    </div>
  );
}
