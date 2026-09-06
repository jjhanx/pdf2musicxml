/**
 * accent 거리만 pending일 때: 같은 음 tenuto와 분리, 앞 음에 유령 accent 없음.
 * Run: npx tsx _smoke/test_accent_no_ghost_sibling.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance.ts';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  applyPendingArticulationOffsetsOnly,
  registerOsmdArticulationFixes,
  registerOsmdPreviewMeasureRangeForArticulation,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { patchOsmdRenderForMeasureNumbers } from '../src/osmdMeasureNumberSuppress.ts';

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

const base = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1">
<measure number="51"><attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem>
  <notations><articulations><tenuto placement="below"/><accent placement="below"/></articulations></notations>
</note>
</measure></part></score-partwise>`;

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
      measureMxl: '51',
      noteIndex: 1,
      articulation: 'accent',
      placement: 'below' as const,
      distance: '5',
      pitchStep: 'B',
      pitchOctave: 4,
    },
  ];

  const host = document.createElement('div');
  host.style.width = '1000px';
  document.body.appendChild(host);

  const xml = prepareArticulationDefaultYForOsmdPreview(
    applyArticulationPlacementFixesToPreviewXml(base, fixes),
  );
  const osmd = new OSMD(host, { autoResize: false, drawTitle: false, useXMLMeasureNumbers: true });
  registerOsmdPreviewXmlForArticulation(osmd, xml);
  registerOsmdArticulationFixes(osmd, fixes);
  registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 51 });
  patchOsmdRenderForMeasureNumbers(osmd, host, () => undefined);
  await osmd.load(xml);
  osmd.render();
  const stats = applyOsmdArticulationOffsetsDetailed(host, osmd);
  applyPendingArticulationOffsetsOnly(host, osmd, fixes);

  const overlays = [...host.querySelectorAll('[data-hitl-art-overlay], [data-hitl-art-tag]')].map((el) => ({
    tag: el.getAttribute('data-hitl-art-tag') || el.getAttribute('data-hitl-art-overlay'),
    spaces: el.getAttribute('data-art-spaces'),
    x: parseFloat(el.getAttribute('x') || '0'),
    y: parseFloat(el.getAttribute('y') || '0'),
  }));
  console.log({ stats, debug: host.getAttribute('data-hitl-art-debug'), overlays });

  const accents = overlays.filter((o) => o.tag === 'accent');
  const tenutos = overlays.filter((o) => o.tag === 'tenuto');
  if (accents.length !== 1) throw new Error(`expected 1 accent overlay, got ${accents.length}`);
  if (tenutos.length !== 1) throw new Error(`expected 1 tenuto overlay, got ${tenutos.length}`);
  if (accents[0]!.spaces !== '5') throw new Error(`accent spaces ${accents[0]!.spaces}`);
  if (Math.abs(accents[0]!.y - tenutos[0]!.y) < 25) {
    throw new Error(`accent/tenuto still overlap: y ${tenutos[0]!.y} vs ${accents[0]!.y}`);
  }
  // 앞 음(A4) 쪽에 유령 accent 없어야 함 — overlay는 B4 음표 X 근처만
  const xs = overlays.map((o) => o.x);
  if (Math.max(...xs) - Math.min(...xs) > 30) {
    throw new Error(`overlays on different notes: xs=${xs.join(',')}`);
  }
  console.log('accent no-ghost sibling OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
