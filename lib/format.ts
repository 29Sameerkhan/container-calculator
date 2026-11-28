// Turso stores created_at as UTC "YYYY-MM-DD HH:MM:SS" (no T, no Z).
// Replacing the space keeps Safari happy; the Z marks it as UTC.
export function formatSavedAt(createdAt: string): string {
  const d = new Date(createdAt.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}


// "13 pallets", or "13 pallets + 3 crates + 2 marketing boxes" when some units
// are crates or marketing material boxes
export function palletCountLabel(pallets: Array<{ kind?: 'crate' | 'marketing' }>): string {
  const crates = pallets.filter(p => p.kind === 'crate').length;
  const marketing = pallets.filter(p => p.kind === 'marketing').length;
  const onPallets = pallets.length - crates - marketing;
  return [
    `${onPallets} pallet${onPallets === 1 ? '' : 's'}`,
    crates > 0 && `${crates} crate${crates === 1 ? '' : 's'}`,
    marketing > 0 && `${marketing} marketing box${marketing === 1 ? '' : 'es'}`,
  ].filter(Boolean).join(' + ');
}

// One marketing material box as printed in the plan and PDF:
// "Marketing Material — 600×400×300 mm, 12kg"
export function marketingLabel(box: { lengthMm: number; widthMm: number; heightMm: number; grossKg: number }): string {
  const n = (v: number) => Math.round(v * 10) / 10;
  return `Marketing Material — ${n(box.lengthMm)}×${n(box.widthMm)}×${n(box.heightMm)} mm, ${n(box.grossKg)}kg`;
}
