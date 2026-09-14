/**
 * Short slur span must not stretch to the next beam group (m50 PL C3→A3).
 * Run: npx tsx _smoke/test_slur_span_endpoint_bounds.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  applyOsmdSlurDistanceOffsets,
  registerOsmdPreviewXmlForSlurs,
} from '../src/osmdChordSlurFix';

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host"><svg>' +
    '<g class="vf-stavetie"><path id="slur" d="M 82 120 C 95 100 120 100 132 120"/></g>' +
    '<g class="vf-stavetie"><path id="slur2" d="M 257 110 C 280 90 310 90 332 110"/></g>' +
    '<g class="vf-stem"><path d="M 82 130 L 82 90"/></g>' +
    '<g class="vf-stem"><path d="M 107 125 L 107 85"/></g>' +
    '<g class="vf-stem"><path d="M 132 120 L 132 70"/></g>' +
    '<g class="vf-stem"><path d="M 257 125 L 257 85"/></g>' +
    '<g class="vf-stem"><path d="M 80 160 L 80 40"/></g>' +
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
    <measure number="50">
      <attributes><divisions>4</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type><stem>up</stem>
        <notations><slur type="start" number="1" placement="above" data-hitl-slur-distance="1"/></notations></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations><slur type="stop" number="1" placement="above" data-hitl-slur-distance="1"/></notations></note>
    </measure>
  </part>
</score-partwise>`;

function pathMaxX(d: string): number {
  const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const xs: number[] = [];
  for (let i = 0; i < nums.length; i += 2) xs.push(nums[i]!);
  return Math.max(...xs);
}

const host = document.getElementById('host') as HTMLDivElement;
const osmd = {
  EngravingRules: { SpacingBetweenLines: 10 },
  zoom: 1,
  GraphicSheet: { MusicPages: [] },
} as never;
registerOsmdPreviewXmlForSlurs(osmd, xml);

applyOsmdSlurDistanceOffsets(host, osmd);
const slur = document.getElementById('slur') as unknown as SVGPathElement;
const maxX = pathMaxX(slur.getAttribute('d') || '');
const spanAttr = slur.getAttribute('data-hitl-slur-span-x') || '';

// path width 50 → maxExpand 75 → hiBound 207; E3 stem at 257 excluded
assert.ok(maxX < 200, `short slur leaked toward next group: maxX=${maxX}`);
assert.ok(!spanAttr.includes('257'), `span must not target E3 stem: ${spanAttr}`);

console.log('slur span endpoint bounds ok', { maxX, spanAttr });
