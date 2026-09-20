/**
 * 화음 평행 slur SVG — 렌더 후 각 곡선을 멤버 음머리 중심에 스냅.
 * Run: npx tsx _smoke/test_chord_slur_svg_notehead_snap.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  noteheadCentersInStavenote,
  snapOsmdChordSlurSvgToNoteheads,
} from '../src/osmdChordSlurFix';

const OpenSheetMusicDisplay =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const xml = `<?xml version="1.0"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>PR</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations><slur type="start" number="1" placement="above"/></notations></note>
      <note><chord/><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations><slur type="start" number="2" placement="above"/></notations></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations><slur type="start" number="3" placement="above"/></notations></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations><slur type="stop" number="1"/></notations></note>
      <note><chord/><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations><slur type="stop" number="2"/></notations></note>
      <note><chord/><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations><slur type="stop" number="3"/></notations></note>
      <note><rest/><duration>8</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

function pathExtent(path: Element): { minX: number; maxX: number } | null {
  const d = path.getAttribute('d') || '';
  const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const xs: number[] = [];
  for (let i = 0; i < nums.length; i += 2) if (Number.isFinite(nums[i])) xs.push(nums[i]!);
  if (xs.length < 2) return null;
  return { minX: Math.min(...xs), maxX: Math.max(...xs) };
}

const host = document.getElementById('host')!;
const osmd = new OpenSheetMusicDisplay!(host, { autoResize: false, backend: 'svg', drawTitle: false }) as {
  load: (x: string) => Promise<void>;
  render: () => void;
};
await osmd.load(xml);
osmd.render();

const chords = [...host.querySelectorAll('.vf-stavenote')]
  .map((sn) => noteheadCentersInStavenote(sn))
  .filter((h) => h.length >= 2);
assert.ok(chords.length >= 2, `need 2 chord stavenotes, got ${chords.length}`);

const before = [...host.querySelectorAll('.vf-curve path')].map((p) => pathExtent(p));
assert.ok(before.length >= 2, `need ≥2 slur paths, got ${before.length}`);
const beforeSpan = new Set(before.map((e) => (e ? `${e.minX.toFixed(1)}:${e.maxX.toFixed(1)}` : '')));
// OSMD stacks chord slurs on the same X before snap
assert.ok(beforeSpan.size <= 2, `pre-snap spans should collapse: ${[...beforeSpan].join('|')}`);

const n = snapOsmdChordSlurSvgToNoteheads(host, osmd as never);
assert.ok(n >= 2, `snap should fix ≥2 paths, got ${n}`);

const left = [...chords[0]!].sort((a, b) => b.cy - a.cy);
const right = [...chords[1]!].sort((a, b) => b.cy - a.cy);
const after = [...host.querySelectorAll('.vf-curve path[data-hitl-chord-slur-snap]')]
  .map((p) => pathExtent(p))
  .filter((e): e is { minX: number; maxX: number } => !!e);

assert.ok(after.length >= 2, `snapped paths ${after.length}`);
const endXs = after.map((e) => e.maxX).sort((a, b) => a - b);
const headEndXs = right.map((h) => h.cx).sort((a, b) => a - b);
// 이격 머리가 있으면 end X가 서로 달라야 함(공통 stem X 한 점 금지)
const endSpread = Math.max(...endXs) - Math.min(...endXs);
const headSpread = Math.max(...headEndXs) - Math.min(...headEndXs);
if (headSpread > 2) {
  assert.ok(endSpread > 1.5, `end Xs should spread with displaced heads: ends=${endSpread} heads=${headSpread}`);
}
for (let i = 0; i < Math.min(after.length, left.length, right.length); i += 1) {
  const e = after[i]!;
  // 각 끝점이 어떤 머리 중심 근처에 있는지(순번 매칭은 Y 정렬)
  const nearLeft = left.some((h) => Math.abs(h.cx - e.minX) < 8);
  const nearRight = right.some((h) => Math.abs(h.cx - e.maxX) < 8);
  assert.ok(nearLeft && nearRight, `path ${i} ends not near heads: ${e.minX.toFixed(1)}..${e.maxX.toFixed(1)}`);
}

console.log('ok chord slur svg notehead snap', { n, endSpread, headSpread });
