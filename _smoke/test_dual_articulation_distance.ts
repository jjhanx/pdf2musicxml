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
  findArticulationElementsInStavenote,
  registerOsmdArticulationFixes,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { overlayArticulationY, pathStartXY, stackOverlayArtSpaces } from '../src/osmdArticulationOverlay.ts';

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
  if (stacked[1]!.staffSpaces !== 4) throw new Error(`stack bump same-slot → ${stacked[1]!.staffSpaces}`);
  const stackedAdj = stackOverlayArtSpaces([
    { tag: 'tenuto', placement: 'below', staffSpaces: 2, glyph: '–' },
    { tag: 'accent', placement: 'below', staffSpaces: 3, glyph: '>' },
  ]);
  if (stackedAdj[1]!.staffSpaces !== 5) {
    throw new Error(`stack bump adjacent → ${stackedAdj[1]!.staffSpaces}`);
  }
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

  const tagged = [...host.querySelectorAll('[data-hitl-art-tag], [data-hitl-art-overlay]')];
  let bestGap = 0;
  if (tagged.length >= 2) {
    const ys = tagged
      .map((el) => {
        const yAttr = el.getAttribute('y');
        if (yAttr != null && el.tagName.toLowerCase() === 'text') return parseFloat(yAttr);
        return pathStartXY(el)?.y;
      })
      .filter((y): y is number => y != null && Number.isFinite(y))
      .sort((a, b) => a - b);
    if (ys.length >= 2) bestGap = ys[ys.length - 1]! - ys[0]!;
  }
  if (bestGap < 15) {
    const notes = [...host.querySelectorAll('.vf-stavenote')];
    for (const n of notes) {
      const arts = findArticulationElementsInStavenote(n);
      if (arts.length < 2) continue;
      const ys = arts
        .map((el) => pathStartXY(el)?.y)
        .filter((y): y is number => y != null)
        .sort((a, b) => a - b);
      const g = ys[ys.length - 1]! - ys[0]!;
      if (g > bestGap) bestGap = g;
    }
  }
  console.log('native dual gap', bestGap);
  // distance 2 vs 5 → text_line 1 vs 4 → 눈에 띄는 간격
  if (bestGap < 15) {
    throw new Error(`expected native gap>=15 for 2/5, got ${bestGap}`);
  }
  console.log('dual articulation distance ok', { bestGap });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
