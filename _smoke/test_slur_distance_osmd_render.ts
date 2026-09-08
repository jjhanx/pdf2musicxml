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

function pathXNumbers(d: string): number[] {
  const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const xs: number[] = [];
  for (let i = 0; i < nums.length; i += 2) xs.push(nums[i]!);
  return xs;
}

function scalePathXs(d: string, scale: number): string {
  const xs = pathXNumbers(d);
  const minX = Math.min(...xs);
  let numericIndex = 0;
  return d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (raw) => {
    const n = Number(raw);
    const out = numericIndex % 2 === 0 ? minX + (n - minX) * scale : n;
    numericIndex += 1;
    return String(out);
  });
}

function stemXs(host: HTMLElement): number[] {
  const xs: number[] = [];
  for (const path of host.querySelectorAll('.vf-stem path')) {
    const d = path.getAttribute('d') || '';
    const m = /M\s*([-\d.eE+]+)\s+[-\d.eE+]+\s*L\s*([-\d.eE+]+)/i.exec(d);
    if (!m) continue;
    xs.push((Number(m[1]) + Number(m[2])) / 2);
  }
  return xs.filter(Number.isFinite).sort((a, b) => a - b);
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

const initialPaths = slurPaths(host);
const initialPathDs = initialPaths.map((p) => p.getAttribute('d') || '');
const initialMins = initialPathDs.map((d) => Math.min(...pathYNumbers(d)));
const upperBeforeApply = initialMins.indexOf(Math.min(...initialMins));
initialPaths[upperBeforeApply]!.setAttribute('d', scalePathXs(initialPathDs[upperBeforeApply]!, 0.45));

const beforePaths = slurPaths(host).map((p) => p.getAttribute('d') || '');
const beforeMins = beforePaths.map((d) => Math.min(...pathYNumbers(d)));
const stems = stemXs(host);
const leftStem = stems[2];
const rightStem = stems[3];
assert.ok(leftStem != null && rightStem != null && rightStem > leftStem, `missing stem span ${stems.join(',')}`);
const shifted = applyOsmdSlurDistanceOffsets(host, osmd);
const afterPaths = slurPaths(host).map((p) => p.getAttribute('d') || '');
const changed = afterPaths.flatMap((d, i) => (d === beforePaths[i] ? [] : [i]));

assert.equal(shifted, 1);
assert.equal(changed.length, 1, `expected one shifted path, got ${changed.join(',')}`);
const changedIndex = changed[0]!;
const upperIndex = beforeMins.indexOf(Math.min(...beforeMins));
assert.equal(changedIndex, upperIndex, 'slur distance shift should target the upper slur path, not the lower tie');
const afterMin = Math.min(...pathYNumbers(afterPaths[changedIndex]!));
const firstDelta = beforeMins[changedIndex]! - afterMin;
assert.ok(firstDelta >= 30, `above slur should move by staff-space distance, delta=${firstDelta}`);
const afterXs = pathXNumbers(afterPaths[changedIndex]!);
assert.ok(Math.min(...afterXs) <= leftStem + 1, `slur should cover start stem: minX=${Math.min(...afterXs)} stem=${leftStem}`);
assert.ok(
  Math.max(...afterXs) >= rightStem - 1,
  `slur should cover end stem: maxX=${Math.max(...afterXs)} stem=${rightStem} span=${slurPaths(host)[changedIndex]?.getAttribute('data-hitl-slur-span-x')}`,
);

osmd.zoom = 1.5;
osmd.render();
const zoomBeforePaths = slurPaths(host).map((p) => p.getAttribute('d') || '');
const zoomBeforeMins = zoomBeforePaths.map((d) => Math.min(...pathYNumbers(d)));
const zoomShifted = applyOsmdSlurDistanceOffsets(host, osmd);
const zoomAfterPaths = slurPaths(host).map((p) => p.getAttribute('d') || '');
const zoomChanged = zoomAfterPaths.flatMap((d, i) => (d === zoomBeforePaths[i] ? [] : [i]));

assert.equal(zoomShifted, 1);
assert.equal(zoomChanged.length, 1, `expected one shifted path after zoom, got ${zoomChanged.join(',')}`);
const zoomChangedIndex = zoomChanged[0]!;
const zoomAfterMin = Math.min(...pathYNumbers(zoomAfterPaths[zoomChangedIndex]!));
assert.ok(
  zoomBeforeMins[zoomChangedIndex]! - zoomAfterMin >= 30,
  `zoom render should keep slur distance shift, delta=${zoomBeforeMins[zoomChangedIndex]! - zoomAfterMin}`,
);

console.log('slur distance OSMD render ok');
