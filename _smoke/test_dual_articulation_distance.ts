/**
 * 한 음 tenuto+accent — 표별 거리를 네이티브 path에 독립 적용.
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
import { overlayArticulationY, stackOverlayArtSpaces } from '../src/osmdArticulationOverlay.ts';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;

if (suggestStackedArticulationDistance(['auto'], 'auto') !== '3') {
  throw new Error('stack after auto → 3 (+2칸, 네이티브 1칸 겹침과 구분)');
}
{
  const y2 = overlayArticulationY(100, 2, 'below', 10);
  const y5 = overlayArticulationY(100, 5, 'below', 10);
  if (y2 !== 120 || y5 !== 150) throw new Error(`overlay Y ${y2}/${y5}`);
  const stacked = stackOverlayArtSpaces([
    { tag: 'tenuto', placement: 'below', staffSpaces: 2, glyph: '–' },
    { tag: 'accent', placement: 'below', staffSpaces: 2, glyph: '>' },
  ]);
  if (stacked[1]!.staffSpaces !== 3) throw new Error('stack bump');
}

const sample = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1"><measure number="50"><attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><stem>up</stem><notations><articulations><tenuto placement="below"/><accent placement="below"/></articulations></notations></note></measure></part></score-partwise>`;

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
  applyOsmdArticulationOffsetsDetailed(host, osmd);

  const tagged = [...host.querySelectorAll('[data-hitl-art-tag]')].map((el) => ({
    tag: el.getAttribute('data-hitl-art-tag'),
    spaces: el.getAttribute('data-art-spaces'),
    shift: parseFloat(el.getAttribute('data-art-shift-y') || '0'),
  }));
  console.log('tagged', tagged);
  const byTag = Object.fromEntries(tagged.map((t) => [t.tag, t]));
  if (!byTag.tenuto || !byTag.accent) {
    throw new Error(`expected tags, got ${JSON.stringify(tagged)}`);
  }
  if (byTag.tenuto.spaces !== '2' || byTag.accent.spaces !== '5') {
    throw new Error(`spaces ${JSON.stringify(byTag)}`);
  }
  if (Math.abs(byTag.tenuto.shift - byTag.accent.shift) < 15) {
    throw new Error(`shifts too close ${JSON.stringify(byTag)}`);
  }
  console.log('dual articulation distance ok', byTag);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
