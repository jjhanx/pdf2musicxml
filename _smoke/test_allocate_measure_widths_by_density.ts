/**
 * Density-weighted measure width allocation (pure math).
 * Run: npx tsx _smoke/test_allocate_measure_widths_by_density.ts
 */
import assert from 'node:assert/strict';
import { allocateMeasureWidthsByDensity } from '../src/osmdSystemMeasureWidthFix';

{
  const cur = [20, 20, 20];
  const onsets = [2, 2, 10];
  const out = allocateMeasureWidthsByDensity(cur, onsets, [0, 0, 0], {
    perOnset: 3,
    base: 5,
    minShrinkRatio: 0.55,
  });
  const sum = out.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 60) < 1e-6, `sum ${sum}`);
  assert.ok(out[2]! > out[0]!, `dense should be wider: ${out.join(',')}`);
  assert.ok(out[2]! > 20, `dense should grow from 20: ${out[2]}`);
}

{
  // leftover when ideal fits
  const cur = [40, 40, 40];
  const onsets = [2, 2, 8];
  const out = allocateMeasureWidthsByDensity(cur, onsets, [0, 0, 0], {
    perOnset: 2,
    base: 4,
    minShrinkRatio: 0.5,
  });
  assert.ok(Math.abs(out.reduce((a, b) => a + b, 0) - 120) < 1e-6);
  assert.ok(out[2]! > out[0]!);
}

console.log('ok');
