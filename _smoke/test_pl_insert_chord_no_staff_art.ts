/**
 * PL 마디 처음에 표 없는 화음을 넣으면 오선에 accent/tenuto 잔상이 생기면 안 되고,
 * 점음표 duration 점은 남아야 한다.
 *
 * Repro: staff1 첫 음 accent+tenuto, staff2 점2분 화음(표 없음) 같은 박.
 * Run: npx tsx _smoke/test_pl_insert_chord_no_staff_art.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { isDurationDotGlyphPath } from '../src/osmdArticulationOverlay.ts';
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

function visibleModPaths(stave: Element): Array<{ d: string; hidden: boolean }> {
  return [...stave.querySelectorAll('.vf-modifiers path')].map((p) => {
    const hidden =
      p.getAttribute('data-hitl-art-hidden') === '1' ||
      (p as SVGElement).style?.opacity === '0' ||
      p.getAttribute('opacity') === '0';
    return { d: p.getAttribute('d') || '', hidden };
  });
}

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="77">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>12</duration><voice>1</voice><type>half</type><dot/>
        <stem>up</stem><staff>1</staff>
        <notations>
          <articulations>
            <tenuto placement="above"/>
            <accent placement="above"/>
          </articulations>
        </notations>
      </note>
      <backup><duration>12</duration></backup>
      <note>
        <pitch><step>E</step><octave>1</octave></pitch>
        <duration>12</duration><voice>2</voice><type>half</type><dot/>
        <stem>up</stem><staff>2</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>2</octave></pitch>
        <duration>12</duration><voice>2</voice><type>half</type><dot/>
        <stem>up</stem><staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  setupDom();
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '500px';
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
  const plChord = staves.find((s) => s.querySelectorAll('.vf-notehead').length >= 2);
  if (!plChord) throw new Error('PL inserted chord stavenote not found');

  const artEls = findArticulationElementsInStavenote(plChord);
  if (artEls.some((el) => isDurationDotGlyphPath(el.getAttribute('d') || ''))) {
    throw new Error('duration dots were treated as articulation glyphs');
  }

  const mods = visibleModPaths(plChord);
  const dots = mods.filter((m) => isDurationDotGlyphPath(m.d));
  if (!dots.length) throw new Error('dotted half lost its duration dots');
  if (dots.some((d) => d.hidden)) throw new Error('duration dots were hidden as ghost articulations');

  const leftover = mods.filter((m) => !m.hidden && !isDurationDotGlyphPath(m.d));
  if (leftover.length) {
    throw new Error(`ghost accent/tenuto on inserted PL chord: ${leftover.length} path(s)`);
  }

  const overlaysOnPl = [...host.querySelectorAll('[data-hitl-art-overlay]')].filter((el) => {
    if (el.getAttribute('data-hitl-art-hidden') === '1') return false;
    const t = (el.textContent || '').trim();
    return t === '>' || t === '–' || t === '·';
  });
  const plHead = plChord.querySelector('.vf-notehead path');
  const m = /M\s*([-\d.eE+]+)\s+([-\d.eE+]+)/.exec(plHead?.getAttribute('d') || '');
  const plX = m ? parseFloat(m[1]!) : null;
  if (plX != null) {
    const tooClose = overlaysOnPl.filter((el) => {
      const x = parseFloat(el.getAttribute('x') || '');
      return Number.isFinite(x) && Math.abs(x - plX) < 12;
    });
    if (tooClose.length) {
      throw new Error('overlay accent/tenuto parked on inserted PL chord');
    }
  }

  console.log('PL insert chord no staff-art OK', {
    debug: host.getAttribute('data-hitl-art-debug'),
    dots: dots.length,
    artEls: artEls.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
