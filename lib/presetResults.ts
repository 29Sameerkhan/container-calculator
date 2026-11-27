import { RulePreset, ShipmentOrder, ShipmentResult } from '@/lib/types';
import { DEFAULT_PRESET, PRESET_LABELS, RULE_PRESETS } from '@/lib/constants';

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

export interface PresetLink {
  url: string;
  qr: string;   // QR code image (data URL) for the printed page
}

export type PresetLinks = Record<RulePreset, PresetLink>;

// The plan's public 3D page under each preset: /plan/{token}?preset=…
export async function presetLinks(shareUrl: string): Promise<PresetLinks> {
  const { toDataURL } = await import('qrcode');
  const entries = await Promise.all(RULE_PRESETS.map(async (preset): Promise<[RulePreset, PresetLink]> => {
    const url = `${shareUrl}?preset=${preset}`;
    return [preset, { url, qr: await toDataURL(url, { margin: 1, width: 240 }) }];
  }));
  return Object.fromEntries(entries) as PresetLinks;
}

// The PDF's last-page footer: every preset's 3D link, the QR code for the preset
// the plan was saved with
export function presetShareFooter(links: PresetLinks, savedPreset: RulePreset = DEFAULT_PRESET) {
  return {
    qrUrl: links[savedPreset].url,
    links: RULE_PRESETS.map(p => ({ label: PRESET_LABELS[p], url: links[p].url })),
  };
}
