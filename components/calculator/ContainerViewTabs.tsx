'use client';

import { ComponentProps, useState } from 'react';
import ContainerFloorPlan from '@/components/calculator/ContainerFloorPlan';
import Container3DView from '@/components/calculator/Container3DView';
import PdfSideView from '@/components/calculator/PdfSideView';

type Tab = 'plan' | '3d';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'plan', label: 'Floor Plan' },
  { id: '3d', label: '3D View' },
];

type Props = ComponentProps<typeof ContainerFloorPlan> & { initialTab?: Tab };

// Floor plan and 3D view of the same result. Both stay mounted once opened, so
// the floor plan keeps its Top/Side choice and the 3D view keeps its camera.
export default function ContainerViewTabs({ initialTab = 'plan', ...props }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // The 3D scene isn't created until its tab is first opened
  const [opened3d, setOpened3d] = useState(initialTab === '3d');

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
        <ContainerFloorPlan {...props} />
      </div>

      <PdfSideView {...props} />

      {opened3d && (
        <div role="tabpanel" data-pdf-hide className={tab === '3d' ? undefined : 'hidden'}>
          <Container3DView {...props} active={tab === '3d'} />
        </div>
      )}
    </div>
  );
}
