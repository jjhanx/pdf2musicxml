/**
 * tenuto만 있는 XML + HITL addArticulation(accent) — overlay로 표별 거리.
 * Run: npx tsx _smoke/test_dual_art_add_accent_overlay.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance.ts';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdArticulationFixes,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

const sample = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1"><measure number="50"><attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><stem>up><notations><articulations><tenuto placement="below"/></articulations></notations></note></measure></part></score-partwise>`;

// fix malformed stem tag
const sampleFixed = sample.replace('<stem>up><notations>', '<stem>up</stem><notations>');

async function main() {
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
  });

  const fixes = [
    {
      kind: 'setArticulationPlacement' as const,
      partId: 'P1',
      measureMxl: '50',
      noteIndex: 0,
      articulation: 'tenuto',
      placement: 'below' as const,
      distance: '2',
      pitchStep: 'B',
      pitchOctave: 4,
    },
    {
      kind: 'addArticulation' as const,
      partId: 'P1',
      measureMxl: '50',
      noteIndex: 0,
      articulation: 'accent',
      placement: 'below' as const,
      distance: '4',
      pitchStep: 'B',
      pitchOctave: 4,
    },
  ];

  let xml = applyArticulationPlacementFixesToPreviewXml(sampleFixed, fixes);
  xml = prepareArticulationDefaultYForOsmdPreview(xml);

  const host = document.createElement('div');
  host.style.width = '800px';
  document.body.appendChild(host);
  const osmd = new OSMD(host, { autoResize: false, drawTitle: false });
  registerOsmdPreviewXmlForArticulation(osmd, xml);
  registerOsmdArticulationFixes(osmd, fixes);
  await osmd.load(xml);
  osmd.render();
  applyOsmdArticulationOffsetsDetailed(host, osmd);

  const overlays = [...host.querySelectorAll('[data-hitl-art-overlay]')].map((el) => ({
    tag: el.getAttribute('data-hitl-art-overlay'),
    spaces: el.getAttribute('data-art-spaces'),
    shift: el.getAttribute('data-art-shift-y'),
  }));
  console.log(overlays);
  const byTag = Object.fromEntries(overlays.map((o) => [o.tag!, o]));
  if (byTag.tenuto?.spaces !== '2' || byTag.accent?.spaces !== '4') {
    throw new Error(`expected tenuto2 accent4, got ${JSON.stringify(overlays)}`);
  }
  if (byTag.tenuto.shift !== '20' || byTag.accent.shift !== '40') {
    throw new Error(`expected shifts 20/40, got ${JSON.stringify(overlays)}`);
  }
  console.log('add-accent overlay ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
