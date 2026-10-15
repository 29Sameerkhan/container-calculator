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
