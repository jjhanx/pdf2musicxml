/**
 * Measure clip must not cut stem-up beams (narrow Y made 8ths look like quarters).
 * Clip X also expands to include beam/stem glyphs so beams aren't shaved off.
 * Run: npx tsx _smoke/test_clip_keeps_beam_vertical.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import {
  clipOsmdMeasuresToAllocatedWidth,
  expandBoundsForEngravingGlyphs,
} from '../src/osmdMeasureTimingWarning';

const require = createRequire(import.meta.url);
const osmdPkg = require('opensheetmusicdisplay');
const OpenSheetMusicDisplay =
  osmdPkg.OpenSheetMusicDisplay ?? osmdPkg.default?.OpenSheetMusicDisplay ?? osmdPkg.default;

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:900px;height:400px"></div></body></html>',
  { pretendToBeVisual: true },
);
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
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type>
        <stem>up</stem><beam number="1">begin</beam></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><type>16th</type>
        <stem>up</stem><beam number="1">continue</beam><beam number="2">begin</beam></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>16th</type>
        <stem>up</stem><beam number="1">end</beam><beam number="2">end</beam></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>12</duration><type>half</type><dot/></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

const host = document.getElementById('host')!;
const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawTitle: false });
await osmd.load(xml);
osmd.render();

const beamsBefore = host.querySelectorAll('.vf-beam').length;
assert.ok(beamsBefore >= 1, `expected beams before clip, got ${beamsBefore}`);

{
  const g = host.querySelector('g.vf-measure');
  assert.ok(g, 'vf-measure');
  const expanded = expandBoundsForEngravingGlyphs(g!, { left: 1000, right: 1010 });
  assert.ok(
    expanded.right - expanded.left > 20,
    `expand widens for beams/stems, got ${expanded.left}..${expanded.right}`,
  );
  assert.ok(
    expanded.left < 1000 || expanded.right > 1010,
    `expand moves at least one edge, got ${expanded.left}..${expanded.right}`,
  );
}

clipOsmdMeasuresToAllocatedWidth(host, osmd);

const rect = host.querySelector('clipPath[data-hitl-measure-clip] rect');
assert.ok(rect, 'clip rect');
const y = Number(rect!.getAttribute('y'));
const h = Number(rect!.getAttribute('height'));
assert.ok(y <= -200, `clip y must be very negative to keep beams, got ${y}`);
assert.ok(h >= 1000, `clip height must be tall, got ${h}`);

const clipL = Number(rect!.getAttribute('x'));
const clipR = clipL + Number(rect!.getAttribute('width'));
for (const p of host.querySelectorAll('.vf-beam path')) {
  const d = p.getAttribute('d') || '';
  const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  assert.ok(Math.max(...xs) - Math.min(...xs) > 2, 'beam path still has width');
  assert.ok(Math.min(...xs) >= clipL - 0.5, `beam left inside clip, ${Math.min(...xs)} vs ${clipL}`);
  assert.ok(Math.max(...xs) <= clipR + 0.5, `beam right inside clip, ${Math.max(...xs)} vs ${clipR}`);
}

console.log('test_clip_keeps_beam_vertical: OK', { beamsBefore, y, h, clipL, clipR });
