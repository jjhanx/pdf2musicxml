/**
 * UI 실경로: useXMLMeasureNumbers:false + 경량 미리보기(m51–52)
 * → OSMD 마디 0/1 vs HITL measureMxl 51 불일치로 거리가 스킵되던 회귀.
 * Run: npx tsx _smoke/test_m51_b4_dual_art.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance.ts';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { resolveOsmdGraphicMeasureMxl } from '../shared/musicXmlMeasureRange.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdArticulationFixes,
  registerOsmdPreviewMeasureRangeForArticulation,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

{
  const range = { start: 51, end: 52 };
  if (resolveOsmdGraphicMeasureMxl(0, range) !== 51) throw new Error('local0→51');
  if (resolveOsmdGraphicMeasureMxl(1, range) !== 52) throw new Error('local1→52');
  if (resolveOsmdGraphicMeasureMxl(51, range) !== 51) throw new Error('global51');
}

const sample = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1">
<measure number="51"><attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem><notations><articulations><staccato placement="below"/></articulations></notations></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem></note>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>down</stem></note>
</measure>
<measure number="52"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type><stem>down</stem></note>
</measure>
</part></score-partwise>`;

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
      kind: 'addArticulation' as const,
      partId: 'P1',
      measureMxl: '51',
      noteIndex: 1,
      articulation: 'tenuto',
      placement: 'below' as const,
      distance: '2',
      pitchStep: 'B',
      pitchOctave: 4,
    },
    {
      kind: 'addArticulation' as const,
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

  let xml = applyArticulationPlacementFixesToPreviewXml(sample, fixes);
  xml = prepareArticulationDefaultYForOsmdPreview(xml);

  const host = document.createElement('div');
  host.style.width = '1000px';
  document.body.appendChild(host);
  // UI: 이제는 useXMLMeasureNumbers:true. 로컬(false) 경로도 range 등록으로 통과해야 함.
  for (const useXml of [false, true]) {
    host.innerHTML = '';
    const osmd = new OSMD(host, {
      autoResize: false,
      drawTitle: false,
      useXMLMeasureNumbers: useXml,
    });
    registerOsmdPreviewXmlForArticulation(osmd, xml);
    registerOsmdArticulationFixes(osmd, fixes);
    registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 52 });
    await osmd.load(xml);
    osmd.render();

    const locals: number[] = [];
    forEachGraphicalMeasure(osmd, (gm) => {
      const raw = measureMxlFromGraphic(gm);
      if (raw != null) locals.push(raw);
    });
    console.log('useXML', useXml, 'locals', locals);

    applyOsmdArticulationOffsetsDetailed(host, osmd);

    const notesSvg = [...host.querySelectorAll('.vf-stavenote')];
    const target = notesSvg[1];
    const tagged = [...(target?.querySelectorAll('[data-hitl-art-tag]') || [])].map((el) => ({
      tag: el.getAttribute('data-hitl-art-tag'),
      spaces: el.getAttribute('data-art-spaces'),
    }));
    console.log('m51 #1 tagged', tagged);
    const byTag = Object.fromEntries(tagged.map((t) => [t.tag!, t]));
    if (byTag.tenuto?.spaces !== '2' || byTag.accent?.spaces !== '5') {
      throw new Error(
        `useXML=${useXml} m51 #1 expected tenuto2/accent5, got ${JSON.stringify(tagged)} locals=${JSON.stringify(locals)}`,
      );
    }
  }
  console.log('m51 light-preview dual art ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
