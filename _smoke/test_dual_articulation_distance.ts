/**
 * 한 음에 tenuto+accent — 표별 거리 Δ가 독립인지.
 * Run: npx tsx _smoke/test_dual_articulation_distance.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import {
  applyArticulationPlacementFixesToPreviewXml,
  suggestStackedArticulationDistance,
} from '../shared/musicXmlArticulationDistance.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdArticulationFixes,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;

if (suggestStackedArticulationDistance([], 'auto') !== 'auto') {
  throw new Error('empty→auto');
}
if (suggestStackedArticulationDistance(['auto'], 'auto') !== '2') {
  throw new Error('stack after auto → 2');
}
if (suggestStackedArticulationDistance(['3'], 'auto') !== '4') {
  throw new Error('stack after 3 → 4');
}
if (suggestStackedArticulationDistance(['2'], '5') !== '5') {
  throw new Error('explicit 5 kept');
}

const sample = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1"><measure number="50"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><stem>up</stem><notations><articulations><tenuto placement="below"/><accent placement="below"/></articulations></notations></note><note><rest/><duration>12</duration><type>half</type><dot/></note></measure></part></score-partwise>`;

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
      kind: 'setArticulationPlacement' as const,
      partId: 'P1',
      measureMxl: '50',
      noteIndex: 0,
      articulation: 'accent',
      placement: 'below' as const,
      distance: '5',
      pitchStep: 'B',
      pitchOctave: 4,
    },
  ];
  let xml = applyArticulationPlacementFixesToPreviewXml(sample, fixes);
  xml = prepareArticulationDefaultYForOsmdPreview(xml);

  const host = document.createElement('div');
  host.style.width = '800px';
  document.body.appendChild(host);
  const osmd = new OSMD!(host, { autoResize: false, drawTitle: false });
  registerOsmdPreviewXmlForArticulation(osmd, xml);
  registerOsmdArticulationFixes(osmd, fixes);
  await osmd.load(xml);
  osmd.render();
  const stats = applyOsmdArticulationOffsetsDetailed(host, osmd);
  const shifts = [...host.querySelectorAll('[data-art-shift-y]')].map((el) =>
    parseFloat(el.getAttribute('data-art-shift-y') || '0'),
  );
  const uniq = [...new Set(shifts.filter((n) => n !== 0))];
  if (stats.shifted < 2) {
    throw new Error(`expected ≥2 shifted glyphs, got ${stats.shifted}`);
  }
  if (!uniq.includes(10) || !uniq.includes(40)) {
    throw new Error(`expected tenuto Δ=10 and accent Δ=40, got ${JSON.stringify(uniq)} shifts=${JSON.stringify(shifts)}`);
  }
  console.log('dual articulation distance ok', { stats, uniq });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
