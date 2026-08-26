/**
 * 1748 m26: voice1 순번5·6이 둘 다 A4일 때 `1-6` 앵커는 6번째(4분)여야 함.
 * pitch+layout 근접만 쓰면 5번째 16분에 붙는 회귀.
 * Run: npx tsx _smoke/test_play_order_ref_same_pitch_anchor.ts
 */
import { resolvePlayOrderRefAnchorHit } from '../src/osmdOnsetColumnAlignFix';
import type { PreviewNoteLayoutTarget } from '../shared/musicXmlPlayOrder';

const stub = (id: string) => ({ id } as unknown as SVGGraphicsElement);

function hit(id: string, pitch: string, centerX: number, timestamp: number, heads = 1) {
  return {
    stavenote: stub(id),
    pitches: [pitch],
    pitch,
    voice: '1',
    centerX,
    timestamp,
    heads,
  };
}

function target(pitch: string, po: number, defaultXTenths: number): PreviewNoteLayoutTarget {
  return {
    partId: 'P5',
    measureNumber: 26,
    staff: 1,
    voice: '1',
    pitch,
    defaultXTenths,
    playOrder: null,
    effectivePlayOrder: po,
  };
}

const hits = [
  hit('chord', 'D4', 40, 0, 4),
  hit('a4-16-2', 'A4', 100, 0.25),
  hit('d4-16', 'D4', 120, 0.3125),
  hit('f4-16', 'F4', 140, 0.375),
  hit('a4-16-5', 'A4', 160, 0.4375),
  hit('a4-q-6', 'A4', 185, 0.5),
  hit('g4-q', 'G4', 260, 0.75),
];

const targets: PreviewNoteLayoutTarget[] = [
  target('D4', 1, 32),
  target('F4', 1, 32),
  target('A4', 1, 32),
  target('C5', 1, 32),
  target('A4', 2, 132),
  target('D4', 3, 157),
  target('F4', 4, 182),
  target('A4', 5, 207),
  target('A4', 6, 232),
  target('G4', 7, 332),
];

// layout 그리드 want≈160 → pitch 근접만 쓰면 5번째 A4를 고름
const spanTrap = { originX: 40, spanPx: 240 };
const wantTrap = 40 + ((232 - 32) / 400) * spanTrap.spanPx;
const proxPick = hits
  .filter((h) => h.pitch === 'A4' && h.heads === 1)
  .sort((a, b) => Math.abs(a.centerX - wantTrap) - Math.abs(b.centerX - wantTrap))[0]!;
if ((proxPick.stavenote as { id: string }).id !== 'a4-16-5') {
  throw new Error(`test setup: proximity should prefer 5th, got ${(proxPick.stavenote as { id: string }).id} want=${wantTrap}`);
}

const resolved = resolvePlayOrderRefAnchorHit(hits, targets, '1', 6, undefined, spanTrap);
if (!resolved || (resolved.stavenote as { id: string }).id !== 'a4-q-6') {
  throw new Error(
    `1-6 anchor must be order-6 A4 quarter, got ${(resolved?.stavenote as { id?: string })?.id}`,
  );
}

const order5 = resolvePlayOrderRefAnchorHit(hits, targets, '1', 5, undefined, spanTrap);
if (!order5 || (order5.stavenote as { id: string }).id !== 'a4-16-5') {
  throw new Error(`order 5 must stay on 16th A4, got ${(order5?.stavenote as { id?: string })?.id}`);
}

console.log('play_order_ref_same_pitch_anchor ok');
