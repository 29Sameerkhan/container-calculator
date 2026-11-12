const NK6X6_SERIES = ['12', '13', '14', '17', '30', '46', '60', '60B', '77', '95'];
// These series only come in the 6X4 column past 60 stages (see pumpStageData);
// calling them 4X4 would size the box from the wrong length table
const NK6X4_PAST_60_STAGES = ['03', '05'];

// Single source of truth for product code normalisation. Expands a short pump
// code, SK-{series}-{stages} (e.g. SK-30-20), to its full form
// (SK30-20-NK6X6-30NC). A short code names no coupling, so it gets the most common
// one, 30NC. Any other code comes back as it was, trimmed.
export function normaliseProductCode(code: string): string {
  const trimmed = code.trim();
  const shortPump = /^SK-(\d+[A-Z]?)-(\d+)$/i.exec(trimmed);
  if (!shortPump) return trimmed;
  const series = shortPump[1].toUpperCase();
  const stages = shortPump[2].padStart(2, '0');
  let config = 'NK4X4';
  if (NK6X6_SERIES.includes(series)) config = 'NK6X6';
  else if (NK6X4_PAST_60_STAGES.includes(series) && Number(stages) > 60) config = 'NK6X4';
  return `SK${series}-${stages}-${config}-30NC`;
}
