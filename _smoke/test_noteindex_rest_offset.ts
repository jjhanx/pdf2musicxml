/**
 * Leading rest: editor noteIndex 1 (first pitch) must map to OSMD ord 0.
 * claimed=none regression. Run: npx tsx _smoke/test_noteindex_rest_offset.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance.ts';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdArticulationFixes,
  registerOsmdPreviewMeasureRangeForArticulation,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { patchOsmdRenderForMeasureNumbers } from '../src/osmdMeasureNumberSuppress.ts';

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

const xml0 = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1">
<measure number="51"><attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
<note><rest/><duration>1</duration><type>16th</type></note>
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

  // Editor: #0=rest, #1=A4, #2=B4 — accent on #2
  const fixes = [
    {
      kind: 'setArticulationPlacement' as const,
      partId: 'P1',
      measureMxl: '51',
      noteIndex: 2,
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
    applyArticulationPlacementFixesToPreviewXml(xml0, fixes),
  );
  const osmd = new OSMD(host, { autoResize: false, drawTitle: false, useXMLMeasureNumbers: true });
  registerOsmdPreviewXmlForArticulation(osmd, xml);
  registerOsmdArticulationFixes(osmd, fixes);
  registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 51 });
  patchOsmdRenderForMeasureNumbers(osmd, host, () => undefined);
  await osmd.load(xml);
  osmd.render();
  const stats = applyOsmdArticulationOffsetsDetailed(host, osmd);
  const debug = host.getAttribute('data-hitl-art-debug') || '';
  console.log({ stats, debug, shifted: host.getAttribute('data-hitl-art-shifted') });
  if (host.getAttribute('data-hitl-art-shifted') === '0' || /miss pending/.test(debug)) {
    throw new Error(`claimed=none regression: ${debug}`);
  }
  if (!/accent@5/.test(debug)) throw new Error(`expected accent@5 in debug: ${debug}`);
  const overlays = [...host.querySelectorAll('[data-hitl-art-overlay]')];
  if (!overlays.length) throw new Error('no overlays');
  console.log('noteindex rest offset OK', debug);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
