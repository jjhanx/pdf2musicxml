/**
 * HITL sync: pending fixes must stay when apply returns applied=0 (skip/fail).
 * Mirrors syncOmrReviewMxl / applyFixesToMxl clear rules.
 */
function shouldClearPending(
  hitlStats: { applied: number; skipped: number } | null,
): { clear: boolean; applied: number; skipped: number } {
  if (!hitlStats) return { clear: false, applied: 0, skipped: 0 };
  if (hitlStats.applied > 0) {
    return { clear: true, applied: hitlStats.applied, skipped: hitlStats.skipped };
  }
  return { clear: false, applied: 0, skipped: hitlStats.skipped };
}

const cases: Array<{
  name: string;
  stats: { applied: number; skipped: number } | null;
  expectClear: boolean;
}> = [
  { name: 'script null', stats: null, expectClear: false },
  { name: 'all skipped', stats: { applied: 0, skipped: 3 }, expectClear: false },
  { name: 'applied 0 skipped 0', stats: { applied: 0, skipped: 0 }, expectClear: false },
  { name: 'partial ok', stats: { applied: 1, skipped: 2 }, expectClear: true },
  { name: 'all applied', stats: { applied: 2, skipped: 0 }, expectClear: true },
];

let failed = 0;
for (const c of cases) {
  const r = shouldClearPending(c.stats);
  if (r.clear !== c.expectClear) {
    console.error(`FAIL ${c.name}: clear=${r.clear} expected ${c.expectClear}`);
    failed += 1;
  }
}
if (failed) process.exit(1);
console.log('OK hitl pending keep on skip/fail');
