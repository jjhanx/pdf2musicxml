/**
 * 단일 이음줄은 화음 SVG 스냅 대상이 아님 — Y를 오선 밖으로 밀지 않음.
 * Run: npx tsx _smoke/test_single_slur_no_chord_snap_y.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import { snapOsmdChordSlurSvgToNoteheads } from '../src/osmdChordSlurFix';

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

// 화음 + 단일 이음줄(비평행) — snap이 단일 곡선을 건드리면 안 됨
const xml = `<?xml version="1.0"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>PR</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations><slur type="start" number="1" placement="above"/></notations></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations><slur type="stop" number="1"/></notations></note>
      <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem></note>
      <note><rest/><duration>8</duration><voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

function pathMidY(path: Element): number {
  const d = path.getAttribute('d') || '';
  const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const ys: number[] = [];
  for (let i = 1; i < nums.length; i += 2) if (Number.isFinite(nums[i])) ys.push(nums[i]!);
  return ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : NaN;
}

const host = document.getElementById('host')!;
const osmd = new OpenSheetMusicDisplay!(host, { autoResize: false, backend: 'svg', drawTitle: false }) as {
  load: (x: string) => Promise<void>;
  render: () => void;
};
await osmd.load(xml);
osmd.render();

const paths = [...host.querySelectorAll('.vf-curve path')];
assert.ok(paths.length >= 1, 'need a slur path');
const before = paths.map((p) => ({ d: p.getAttribute('d') || '', mid: pathMidY(p) }));

const n = snapOsmdChordSlurSvgToNoteheads(host, osmd as never);
assert.equal(n, 0, `single slur group must not be snapped, got ${n}`);

for (let i = 0; i < paths.length; i += 1) {
  assert.equal(paths[i]!.getAttribute('d'), before[i]!.d, 'path d must be unchanged');
  assert.ok(!paths[i]!.hasAttribute('data-hitl-chord-slur-snap'));
}

console.log('ok single slur no chord snap y');
