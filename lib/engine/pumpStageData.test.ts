// Spot checks of the stage formulas against Yagnik's
// SLEKA PUMP LENGTH & TUBE LENGTH_30.10.2026 Excel. Run: npx tsx lib/engine/pumpStageData.test.ts
import { pumpLength, calcPumpBox } from './pumpStageData';

// [series, stages, column (null = no column in the code), Excel pump length, Excel tube length]
const CASES: [string, number, string | null, number, number][] = [
  ['SK02', 10, null, 369, 469],     // SK02-03 4X4, 3 C.S.
  ['SK03', 40, '4X4', 1031, 1131],  // SK02-03 4X4, 4 C.S.
  ['SK03', 75, null, 1817, 1927],   // SK03 6X4 (past the 4X4 table, so 6X4 with no column)
  ['SK05', 10, null, 400, 500],
  ['SK05', 34, null, 1008, 1108],
  ['SK09', 25, null, 1474, 1574],   // 4X4
  ['SK09', 25, '6X4', 1490, 1600],
  ['SK12', 7, null, 704.5, 814.5],
  ['SK17', 7, '4X6', 694, 794],
  ['SK17', 7, '6X6', 704.5, 814.5],
  ['SK30', 13, null, 1529, 1639],
  ['SK46', 20, null, 2541, 2651],
  ['SK60', 28, null, 3445, 3555],
  ['SK77', 4, null, 959, 1079],
];

let failed = 0;
for (const [series, stages, column, pump, tube] of CASES) {
  const p = pumpLength(series, stages, column);
  const L = calcPumpBox(series, stages, column)?.L;
  const ok = p === pump && L === Math.round(tube);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${series} ${stages} stg ${column ?? ''}`.padEnd(26) +
    `pump ${p} (Excel ${pump})  box ${L} (Excel tube ${tube})`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
if (failed > 0) process.exit(1);
