/**
 * 실제 OSMD SVG slur 거리 적용 회귀.
 * Run: npx tsx _smoke/test_slur_distance_osmd_render.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { applySlurDistanceFixesToPreviewXml } from '../shared/musicXmlSlurDistance';
import {
  applyOsmdSlurDistanceOffsets,
  prepareGraphicalSlursForOsmdPreview,
  registerOsmdPreviewXmlForSlurs,
} from '../src/osmdChordSlurFix';

const OpenSheetMusicDisplay =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;
if (!OpenSheetMusicDisplay) throw new Error('OSMD missing');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>', { pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="53">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>up</stem><tie type="start"/><notations><tied type="start"/></notations></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>up</stem><tie type="stop"/><notations><tied type="stop"/></notations></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>up</stem><beam number="1">begin</beam><notations><slur type="start" number="1" placement="above"/></notations></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>up</stem><beam number="1">end</beam><notations><slur type="stop" number="1" placement="above"/></notations></note>
    </measure>
  </part>
</score-partwise>`;

function pathYNumbers(d: string): number[] {
  const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const ys: number[] = [];
  for (let i = 1; i < nums.length; i += 2) ys.push(nums[i]!);
  return ys;
}

function slurPaths(host: HTMLElement): SVGPathElement[] {
  const candidates = [...host.querySelectorAll('path')] as SVGPathElement[];
  const slurLike = candidates.filter((p) => {
    const cls =
      (p.closest('.vf-stavetie,.vf-curve,.vf-tie')?.getAttribute('class') || '') +
      ' ' +
      (p.parentElement?.getAttribute('class') || '');
    const d = p.getAttribute('d') || '';
    return /vf-stavetie|vf-curve|vf-tie/i.test(cls) && /[CQ]/.test(d);
  });
  assert.ok(slurLike.length > 0, `no slur-like path. classes=${candidates.map((p) => p.parentElement?.getAttribute('class') || '').join(',')}`);
  return slurLike;
}

const hintedXml = applySlurDistanceFixesToPreviewXml(xml, [
  {
    kind: 'setSlurPlacement',
    partId: 'P1',
    measureMxl: '53',
    noteIndex: 2,
    slurEnd: 'start',
    placement: 'above',
    distance: '5',
    pitchStep: 'C',
    pitchOctave: 5,
  },
]);

const host = document.getElementById('host') as HTMLDivElement;
const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawTitle: false });
registerOsmdPreviewXmlForSlurs(osmd, hintedXml);
await osmd.load(hintedXml);
prepareGraphicalSlursForOsmdPreview(osmd);
osmd.render();

const beforePaths = slurPaths(host).map((p) => p.getAttribute('d') || '');
const beforeMins = beforePaths.map((d) => Math.min(...pathYNumbers(d)));
const shifted = applyOsmdSlurDistanceOffsets(host, osmd);
const afterPaths = slurPaths(host).map((p) => p.getAttribute('d') || '');
const changed = afterPaths.flatMap((d, i) => (d === beforePaths[i] ? [] : [i]));

assert.equal(shifted, 1);
assert.equal(changed.length, 1, `expected one shifted path, got ${changed.join(',')}`);
const changedIndex = changed[0]!;
const upperIndex = beforeMins.indexOf(Math.min(...beforeMins));
assert.equal(changedIndex, upperIndex, 'slur distance shift should target the upper slur path, not the lower tie');
const afterMin = Math.min(...pathYNumbers(afterPaths[changedIndex]!));
assert.ok(afterMin < beforeMins[changedIndex]! - 10, `above slur should move upward: before=${beforeMins[changedIndex]} after=${afterMin}`);

console.log('slur distance OSMD render ok');
