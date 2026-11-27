import { RulePreset, ShipmentOrder, ShipmentResult } from '@/lib/types';
import { DEFAULT_PRESET, RULE_PRESETS } from '@/lib/constants';

// A preset whose calculation failed holds the error message instead
export type PresetResults = Record<RulePreset, ShipmentResult | { error: string }>;

// The plan under every rule preset, for the PDF. The engine runs server-side
// (/api/calculate), once per preset in parallel, on the given orders. `current`
// is the result already on screen or saved: it stands in for its own preset so
// that section keeps any floor positions moved by hand. A failed preset doesn't
// stop the others (e.g. an old saved order the engine now rejects).
export async function fetchAllPresetResults(
  orders: ShipmentOrder[],
  current?: ShipmentResult,
): Promise<PresetResults> {
  const currentPreset = current?.preset ?? (current ? DEFAULT_PRESET : undefined);
  const entries = await Promise.all(RULE_PRESETS.map(async (preset): Promise<[RulePreset, PresetResults[RulePreset]]> => {
    if (current && preset === currentPreset) return [preset, current];
    try {
      const res = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders, preset }),
      });
      const data = await res.json();
      if (!res.ok) return [preset, { error: data.message || data.error || 'Calculation failed' }];
      return [preset, data.result as ShipmentResult];
    } catch {
      return [preset, { error: 'Network error' }];
    }
  }));
  return Object.fromEntries(entries) as PresetResults;
}
