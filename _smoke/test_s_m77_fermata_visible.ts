/**
 * S 77마디 끝 음 늘임표는 미리보기에서 숨기면 안 되고, 다시 넣어도 보여야 한다.
 *
 * Repro: P1 m77 dotted-half + 16th tenuto + 16th + eighth+fermata.
 * Run: npx tsx _smoke/test_s_m77_fermata_visible.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { isDurationDotGlyphPath, isFermataGlyphPath } from '../src/osmdArticulationOverlay.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  findArticulationElementsInStavenote,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { prepareArticulationDefaultYForOsmdPreview, repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;
if (!OSMD) throw new Error('OSMD missing');

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 0;
    },
  });
  const proto = dom.window.SVGGraphicsElement.prototype as SVGGraphicsElement;
  if (!proto.getBBox) {
    proto.getBBox = function () {
      return { x: 0, y: 0, width: 12, height: 12 } as DOMRect;
    };
  }
}

function isHidden(el: Element): boolean {
  return (
    el.getAttribute('data-hitl-art-hidden') === '1' ||
    (el as SVGElement).style?.opacity === '0' ||
    el.getAttribute('opacity') === '0'
  );
}

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="77">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>12</duration><voice>1</voice><type>half</type><dot/>
        <stem>up</stem>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>1</duration><voice>1</voice><type>16th</type>
        <stem>up</stem>
        <beam number="1">begin</beam>
        <notations>
          <articulations><tenuto placement="above" default-y="17"/></articulations>
        </notations>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>1</duration><voice>1</voice><type>16th</type>
        <stem>up</stem>
        <beam number="1">continue</beam>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>2</duration><voice>1</voice><type>eighth</type>
        <stem>up</stem>
        <beam number="1">end</beam>
        <notations><fermata type="upright" placement="below"/></notations>
      </note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  setupDom();
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '400px';
  document.body.appendChild(host);

  const loadXml = prepareArticulationDefaultYForOsmdPreview(repairTimelineForOsmdPreview(xml));
  const osmd = new OSMD(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    useXMLMeasureNumbers: true,
  });
  registerOsmdPreviewXmlForArticulation(osmd, loadXml);
  await osmd.load(loadXml);
  osmd.render();
  applyOsmdArticulationOffsetsDetailed(host, osmd);

  const staves = [...host.querySelectorAll('.vf-stavenote')];
  if (staves.length < 4) throw new Error(`expected 4 stavenotes, got ${staves.length}`);
  const last = staves[staves.length - 1]!;
  const mods = [...last.querySelectorAll('.vf-modifiers path')].map((p) => {
    const d = p.getAttribute('d') || '';
    return { hidden: isHidden(p), fermata: isFermataGlyphPath(d), dot: isDurationDotGlyphPath(d), d: d.slice(0, 40) };
  });
  const fermata = mods.filter((m) => m.fermata);
  if (!fermata.length) throw new Error(`OSMD did not draw a fermata path: ${JSON.stringify(mods)}`);
  if (fermata.some((m) => m.hidden)) {
    throw new Error('fermata glyph was hidden as a ghost articulation');
  }
  if (findArticulationElementsInStavenote(last).some((el) => isFermataGlyphPath(el.getAttribute('d') || ''))) {
    throw new Error('fermata was treated as an overlay articulation glyph');
  }
  console.log('S m77 fermata visible OK', { debug: host.getAttribute('data-hitl-art-debug') });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
