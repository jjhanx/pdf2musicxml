/**
 * Last note remesh must keep trailing room ≈ same-duration gap (not flush to barline).
 * Run: npx tsx _smoke/test_last_note_trailing_duration.ts
 */
import assert from 'node:assert/strict';
import { placementSpanFromExtentAndLayouts } from '../src/osmdOnsetColumnAlignFix';

const BASE = 32;
const SPAN = 400;

/** wantX for layout tenths using same formula as remesh. */
function wantX(originX: number, spanPx: number, lx: number): number {
  const frac = Math.max(0, Math.min(1, (lx - BASE) / SPAN));
  return originX + frac * spanPx;
}

{
  // 4 equal quarters: layout 32,132,232,332 — without extend, last sits at rightEdge
  const left = 100;
  const right = 500;
  const lxs = [32, 132, 232, 332];
  const noExt = placementSpanFromExtentAndLayouts(left, right, lxs, false)!;
  const withExt = placementSpanFromExtentAndLayouts(left, right, lxs, true)!;
  const lastNo = wantX(noExt.originX, noExt.spanPx, 332);
  const lastYes = wantX(withExt.originX, withExt.spanPx, 332);
  const gapYes =
    wantX(withExt.originX, withExt.spanPx, 232) - wantX(withExt.originX, withExt.spanPx, 132);
  const trailYes = right - lastYes;
  assert.ok(Math.abs(lastNo - right) < 0.5, `no-extend last at rightEdge, got ${lastNo} vs ${right}`);
  assert.ok(trailYes + 0.5 >= gapYes * 0.95, `trail ${trailYes} >= gap ${gapYes}`);
  assert.ok(Math.abs(trailYes - gapYes) / gapYes < 0.08, `trail≈gap, trail=${trailYes} gap=${gapYes}`);
}

{
  // half + half: 32, 232 → trail after last should ≈ gap
  const left = 50;
  const right = 450;
  const lxs = [32, 232];
  const span = placementSpanFromExtentAndLayouts(left, right, lxs, true)!;
  const a = wantX(span.originX, span.spanPx, 32);
  const b = wantX(span.originX, span.spanPx, 232);
  const trail = right - b;
  const gap = b - a;
  assert.ok(trail + 0.5 >= gap * 0.95, `half trail ${trail} >= gap ${gap}`);
}

{
  // Softmax-only path: extend=false keeps used-range mapping (no densify via full 32..432)
  const left = 200;
  const right = 320; // tight Softmax cluster
  const lxs = [32, 132, 232, 332];
  const tight = placementSpanFromExtentAndLayouts(left, right, lxs, false)!;
  const g0 = wantX(tight.originX, tight.spanPx, 132) - wantX(tight.originX, tight.spanPx, 32);
  const ext = placementSpanFromExtentAndLayouts(left, right, lxs, true)!;
  const g1 = wantX(ext.originX, ext.spanPx, 132) - wantX(ext.originX, ext.spanPx, 32);
  assert.ok(g0 > g1 + 1, `extend on tight Softmax densifies (${g0} → ${g1}); default off`);
}

console.log('ok: last note trailing duration');
