/**
 * B4 tenuto(above) + HITL accent — path `d` 좌표로 표별 이동 (getBBox 실패해도).
 * Run: npx tsx _smoke/test_dual_art_dom_probe.ts
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
import { pathStartXY } from '../src/osmdArticulationOverlay.ts';

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

const sample = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1"><measure number="50"><attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem><notations><articulations><tenuto placement="below"/></articulations></notations></note>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem><notations><articulations><tenuto placement="below"/></articulations></notations></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>down</stem><notations><articulations><tenuto placement="above" default-y="-5"/></articulations></notations></note>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem><notations><articulations><tenuto placement="below"/></articulations></notations></note>
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
      measureMxl: '50',
      noteIndex: 2,
      articulation: 'tenuto',
      placement: 'above' as const,
      distance: '2',
      pitchStep: 'B',
      pitchOctave: 4,
    },
    {
      kind: 'addArticulation' as const,
      partId: 'P1',
      measureMxl: '50',
      noteIndex: 2,
      articulation: 'accent',
      placement: 'above' as const,
      distance: '5',
      pitchStep: 'B',
      pitchOctave: 4,
    },
  ];

  let xml = applyArticulationPlacementFixesToPreviewXml(sample, fixes);
  xml = prepareArticulationDefaultYForOsmdPreview(xml);

  const host = document.createElement('div');
  host.style.width = '900px';
  document.body.appendChild(host);
  const osmd = new OSMD(host, { autoResize: false, drawTitle: false });
  registerOsmdPreviewXmlForArticulation(osmd, xml);
  registerOsmdArticulationFixes(osmd, fixes);
  await osmd.load(xml);
  osmd.render();
  applyOsmdArticulationOffsetsDetailed(host, osmd);

  const notes = [...host.querySelectorAll('.vf-stavenote')];
  const b4 = notes[2]!;
  const tagged = [...b4.querySelectorAll('[data-hitl-art-tag]')].map((el) => {
    const start = pathStartXY(el);
    const shift = parseFloat(el.getAttribute('data-art-shift-y') || '0');
    return {
      tag: el.getAttribute('data-hitl-art-tag'),
      spaces: el.getAttribute('data-art-spaces'),
      shift,
      pathY: start?.y,
      visualY: start ? start.y + shift : null,
    };
  });
  console.log('B4 tagged', tagged);
  const byTag = Object.fromEntries(tagged.map((t) => [t.tag!, t]));
  if (!byTag.tenuto || !byTag.accent) throw new Error(`missing tags ${JSON.stringify(tagged)}`);
  if (byTag.tenuto.spaces !== '2' || byTag.accent.spaces !== '5') {
    throw new Error(`spaces ${JSON.stringify(byTag)}`);
  }
  if (byTag.tenuto.visualY == null || byTag.accent.visualY == null) {
    throw new Error('no visualY');
  }
  // above: 더 큰 칸 = 더 작은 Y
  if (!(byTag.accent.visualY < byTag.tenuto.visualY - 10)) {
    throw new Error(`accent should be farther above: ${JSON.stringify(byTag)}`);
  }
  // 네이티브가 숨겨지지 않았는지
  const hidden = b4.querySelectorAll('[data-hitl-art-hidden]').length;
  if (hidden > 0) throw new Error(`should not hide natives, hidden=${hidden}`);
  console.log('dom probe ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
