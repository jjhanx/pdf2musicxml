/**
 * Exact UI path after 6fa2b01: xml=previewXml (no arts), load embeds fixes,
 * then distance-only change via applyPending (no remount).
 * Run: npx tsx _smoke/test_exact_ui_distance_path.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance.ts';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  applyPendingArticulationOffsetsOnly,
  findArticulationElementsInStavenote,
  registerOsmdArticulationFixes,
  registerOsmdPreviewMeasureRangeForArticulation,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { pathStartXY } from '../src/osmdArticulationOverlay.ts';
import { patchOsmdRenderForMeasureNumbers } from '../src/osmdMeasureNumberSuppress.ts';
import { alignOsmdPreviewNotesByOnsetColumn, registerOsmdPreviewXmlForAlign } from '../src/osmdOnsetColumnAlignFix.ts';

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

const previewXml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1">
<measure number="51"><attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem><notations><articulations><staccato placement="below"/></articulations></notations></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem></note>
</measure></part></score-partwise>`;

function snap(host: HTMLElement) {
  const tagged = [...host.querySelectorAll('[data-hitl-art-tag], [data-hitl-art-overlay]')];
  if (tagged.length) {
    return tagged.map((el) => {
      const yAttr = el.getAttribute('y');
      const visualY =
        yAttr != null && el.tagName.toLowerCase() === 'text'
          ? parseFloat(yAttr)
          : (() => {
              const start = pathStartXY(el);
              const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?/.exec(
                el.getAttribute('transform') || '',
              );
              const ty = m ? parseFloat(m[2] ?? '0') : 0;
              return (start?.y ?? 0) + ty;
            })();
      return {
        tag: el.getAttribute('data-hitl-art-tag') || el.getAttribute('data-hitl-art-overlay'),
        spaces: el.getAttribute('data-art-spaces'),
        visualY,
        attrShift: el.getAttribute('data-art-shift-y'),
        css: (el as any).style?.transform || '',
        transform: el.getAttribute('transform'),
      };
    });
  }
  const notes = [...host.querySelectorAll('.vf-stavenote')];
  const b4 = notes[1]!;
  return findArticulationElementsInStavenote(b4).map((el) => {
    const start = pathStartXY(el)!;
    const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?/.exec(el.getAttribute('transform') || '');
    const ty = m ? parseFloat(m[2] ?? '0') : 0;
    return {
      tag: el.getAttribute('data-hitl-art-tag'),
      spaces: el.getAttribute('data-art-spaces'),
      visualY: start.y + ty,
      attrShift: el.getAttribute('data-art-shift-y'),
      css: (el as any).style?.transform || '',
      transform: el.getAttribute('transform'),
    };
  });
}

function gap(rows: { visualY: number }[]) {
  if (rows.length < 2) return 0;
  return Math.abs(rows[0]!.visualY - rows[1]!.visualY);
}

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

  const host = document.createElement('div');
  host.style.width = '1000px';
  document.body.appendChild(host);

  let fixes = [
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
      distance: '3',
      pitchStep: 'B',
      pitchOctave: 4,
    },
  ];

  // === OsmdBlock mount: xml=previewXml, load embeds fixes ===
  const xmlForOsmdLoad = prepareArticulationDefaultYForOsmdPreview(
    applyArticulationPlacementFixesToPreviewXml(previewXml, fixes),
  );
  const osmd = new OSMD(host, {
    autoResize: false,
    drawTitle: false,
    useXMLMeasureNumbers: true,
  });
  registerOsmdPreviewXmlForArticulation(osmd, xmlForOsmdLoad);
  registerOsmdPreviewXmlForAlign(osmd, previewXml);
  registerOsmdArticulationFixes(osmd, fixes);
  registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 51 });
  patchOsmdRenderForMeasureNumbers(osmd, host, () => undefined);
  await osmd.load(xmlForOsmdLoad);
  osmd.render();
  alignOsmdPreviewNotesByOnsetColumn(osmd);
  applyOsmdArticulationOffsetsDetailed(host, osmd);

  let rows = snap(host);
  console.log('A after mount (2 vs 3)', JSON.stringify(rows, null, 2), 'gap', gap(rows));
  if (gap(rows) < 8) throw new Error(`A FAIL mount gap=${gap(rows)}`);

  // === Distance-only change: NO remount, like artPreviewOsmdKey without distance ===
  fixes = [
    { ...fixes[0]!, distance: '2' },
    { ...fixes[1]!, distance: '8' },
  ];
  const hintXml = applyArticulationPlacementFixesToPreviewXml(previewXml, fixes);
  registerOsmdPreviewXmlForArticulation(osmd, hintXml);
  const shifted = applyPendingArticulationOffsetsOnly(host, osmd, fixes);
  rows = snap(host);
  console.log('B after distance 2 vs 8 (no remount)', JSON.stringify(rows, null, 2), 'gap', gap(rows), 'shifted', shifted);
  if (gap(rows) < 40) {
    throw new Error(`B FAIL distance-only gap=${gap(rows)} — this is the live UI path`);
  }

  // Change ONLY accent again
  fixes = [
    { ...fixes[0]!, distance: '2' },
    { ...fixes[1]!, distance: '4' },
  ];
  registerOsmdPreviewXmlForArticulation(
    osmd,
    applyArticulationPlacementFixesToPreviewXml(previewXml, fixes),
  );
  applyPendingArticulationOffsetsOnly(host, osmd, fixes);
  rows = snap(host);
  console.log('C after accent→4', JSON.stringify(rows, null, 2), 'gap', gap(rows));
  const g = gap(rows);
  // VexFlow snap 때문에 2/4 간격은 작을 수 있음 — 2/8보다 작고, 0은 아니어야 함
  if (g >= 40) {
    throw new Error(`C FAIL 2/4 should be tighter than 2/8, got ${g}`);
  }
  if (g < 3) {
    throw new Error(`C FAIL 2/4 collapsed to ${g}`);
  }
  console.log('EXACT UI PATH OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
