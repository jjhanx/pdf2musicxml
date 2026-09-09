/**
 * Slur distance SVG span must not stretch to the next note when the current
 * path already reaches the intended end stem.
 * Run: npx tsx _smoke/test_slur_span_no_next_stem.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  applyOsmdSlurDistanceOffsets,
  registerOsmdPreviewXmlForSlurs,
} from '../src/osmdChordSlurFix';

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host"><svg>' +
    '<g class="vf-stavetie"><path id="slur" d="M 10 50 C 40 20 80 20 112 50"/></g>' +
    '<g class="vf-stem"><path d="M 10 45 L 10 5"/></g>' +
    '<g class="vf-stem"><path d="M 100 45 L 100 5"/></g>' +
    '<g class="vf-stem"><path d="M 150 45 L 150 5"/></g>' +
    '</svg></div></body></html>',
  { pretendToBeVisual: true },
);
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  SVGPathElement: dom.window.SVGPathElement,
});

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="56">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>down</stem><notations><slur type="start" number="1" placement="above" data-hitl-slur-distance="5"/></notations></note>
      <note><pitch><step>B</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>down</stem><notations><slur type="stop" number="1" placement="above" data-hitl-slur-distance="5"/></notations></note>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><stem>down</stem></note>
    </measure>
  </part>
</score-partwise>`;

function pathXNumbers(d: string): number[] {
  const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const xs: number[] = [];
  for (let i = 0; i < nums.length; i += 2) xs.push(nums[i]!);
  return xs;
}

const host = document.getElementById('host') as HTMLDivElement;
const osmd = {
  EngravingRules: { SpacingBetweenLines: 10 },
  zoom: 1,
  GraphicSheet: { MusicPages: [] },
} as never;
registerOsmdPreviewXmlForSlurs(osmd, xml);

const shifted = applyOsmdSlurDistanceOffsets(host, osmd);
const slur = document.getElementById('slur') as unknown as SVGPathElement;
const xs = pathXNumbers(slur.getAttribute('d') || '');
const maxX = Math.max(...xs);

assert.equal(shifted, 1);
assert.ok(maxX < 130, `slur span leaked to next stem: maxX=${maxX}`);
assert.ok(
  !(slur.getAttribute('data-hitl-slur-span-x') || '').includes('150'),
  `span should not target next note stem: ${slur.getAttribute('data-hitl-slur-span-x')}`,
);

console.log('slur span no next stem ok');
