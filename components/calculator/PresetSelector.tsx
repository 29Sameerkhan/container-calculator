'use client';

import { KeyboardEvent, useRef } from 'react';
import { RulePreset } from '@/lib/types';
import { PRESET_LABELS, PRESET_SUMMARIES, RULE_PRESETS } from '@/lib/constants';

interface Props {
  value: RulePreset;
  onChange: (preset: RulePreset) => void;
  // True while the engine is re-running for a newly picked preset
  busy?: boolean;
}

// Segmented control for the packing rules, with a one-line note on what the
// chosen preset changes compared with Standard
export default function PresetSelector({ value, onChange, busy = false }: Props) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  // Arrow keys move between options, as in a radio group
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + RULE_PRESETS.length) % RULE_PRESETS.length;
    buttons.current[next]?.focus();
    onChange(RULE_PRESETS[next]);
  }

  return (
    <div data-pdf-hide className="bg-white rounded-2xl shadow-sm border border-blue-100 px-6 py-4">
      <div className="flex items-center gap-4 flex-wrap">
        <span id="preset-label" className="text-sm font-semibold text-gray-700">
          Packing Rules:
        </span>
        <div
          role="radiogroup"
          aria-labelledby="preset-label"
          className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium"
        >
          {RULE_PRESETS.map((preset, i) => {
            const checked = preset === value;
            return (
              <button
                key={preset}
                ref={el => { buttons.current[i] = el; }}
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => { if (!checked) onChange(preset); }}
                onKeyDown={e => handleKeyDown(e, i)}
                className={`px-4 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
                  checked ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {PRESET_LABELS[preset]}
              </button>
            );
          })}
        </div>
        {busy && <span className="text-xs text-gray-500" role="status">Recalculating…</span>}
      </div>
      <p className="mt-2 text-xs text-gray-500">{PRESET_SUMMARIES[value]}</p>
    </div>
  );
}
