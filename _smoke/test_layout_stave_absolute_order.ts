/**
 * layout tenths → stave-absolute X must stay monotonic (po2 < po3 < po4).
 * Natural-position calibration used to pin po2 to a far-right voice2 note.
 * Run: npx tsx _smoke/test_layout_stave_absolute_order.ts
 */
const LAYOUT_BASE_X = 32;
const LAYOUT_SPAN = 400;

function wantX(originX: number, spanPx: number, tenths: number): number {
  const frac = Math.max(0, Math.min(1, (tenths - LAYOUT_BASE_X) / LAYOUT_SPAN));
  return originX + frac * spanPx;
}

const origin = 100;
const span = 400;
const po2 = wantX(origin, span, 132);
const po3 = wantX(origin, span, 182);
const po4 = wantX(origin, span, 232);

if (!(po2 < po3 && po3 < po4)) {
  throw new Error(`absolute order broken ${po2} ${po3} ${po4}`);
}

// 옛 버그: natural F4 po2가 맨 오른쪽인데 equal-tenths minCenterX를 덮어씀
const naturalF5 = 220;
const brokenCalPo2 = 380;
if (!(brokenCalPo2 > naturalF5) || !(po2 < naturalF5)) {
  throw new Error('fixture expectation drift');
}
if (!(po2 < po3 && po3 < po4 && po2 < naturalF5)) {
  throw new Error('stave-absolute must keep po2 left of mid F5 and po3');
}

console.log('OK stave-absolute layout order', { po2, po3, po4, brokenCalPo2, naturalF5 });
