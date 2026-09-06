/**
 * 증거: 표 draw / HITL apply / UI render 패치 경로에서 표별 Y가 갈리는지.
 * Run: npx tsx _smoke/test_art_draw_forensics.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance.ts';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  findArticulationElementsInStavenote,
  registerOsmdArticulationFixes,
  registerOsmdPreviewMeasureRangeForArticulation,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { pathStartXY } from '../src/osmdArticulationOverlay.ts';
import { registerOsmdPreviewXmlForAlign } from '../src/osmdOnsetColumnAlignFix.ts';
import { patchOsmdRenderForMeasureNumbers } from '../src/osmdMeasureNumberSuppress.ts';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

const sample = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1">
<measure number="51"><attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem></note>
<note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>16th</type><stem>up</stem></note>
</measure></part></score-partwise>`;

function snapB4(host: HTMLElement, label: string) {
  const notes = [...host.querySelectorAll('.vf-stavenote')];
  const b4 = notes[1];
  if (!b4) {
    console.log(label, 'NO B4');
    return [] as Array<{ tag: string | null; spaces: string | null; visualY: number; shift: string | null }>;
  }
  // path 이동 또는 SVG text overlay
  const tagged = [
    ...b4.querySelectorAll('[data-hitl-art-tag]'),
    ...host.querySelectorAll(`[data-hitl-art-overlay]`),
  ];
  // dedupe
  const seen = new Set<Element>();
  const rows = [];
  for (const el of tagged) {
    if (seen.has(el)) continue;
    seen.add(el);
    const tag = el.getAttribute('data-hitl-art-tag') || el.getAttribute('data-hitl-art-overlay');
    const spaces = el.getAttribute('data-art-spaces');
    const yAttr = el.getAttribute('y');
    let visualY = 0;
    if (yAttr != null && el.tagName.toLowerCase() === 'text') {
      visualY = parseFloat(yAttr);
    } else {
      const start = pathStartXY(el);
      const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?/.exec(el.getAttribute('transform') || '');
      const ty = m ? parseFloat(m[2] ?? '0') : 0;
      visualY = (start?.y ?? 0) + ty;
    }
    rows.push({
      tag,
      spaces,
      visualY,
      shift: el.getAttribute('data-art-shift-y'),
    });
  }
  console.log(label, JSON.stringify(rows));
  return rows;
}

function gapOf(rows: Array<{ visualY: number }>): number {
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
      distance: '6',
      pitchStep: 'B',
      pitchOctave: 4,
    },
  ];
  let xml = applyArticulationPlacementFixesToPreviewXml(sample, fixes);
  xml = prepareArticulationDefaultYForOsmdPreview(xml);

  const host = document.createElement('div');
  host.style.width = '900px';
  document.body.appendChild(host);

  console.log('\n===== A: bare render + explicit apply =====');
  {
    const osmd = new OSMD(host, { autoResize: false, drawTitle: false, useXMLMeasureNumbers: true });
    registerOsmdPreviewXmlForArticulation(osmd, xml);
    registerOsmdArticulationFixes(osmd, fixes);
    registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 51 });
    await osmd.load(xml);
    osmd.render();
    snapB4(host, 'A native');
    const st = applyOsmdArticulationOffsetsDetailed(host, osmd);
    const after = snapB4(host, 'A after apply');
    console.log('A stats', st, 'gap', gapOf(after));
    if (gapOf(after) < 15) throw new Error(`A FAIL gap=${gapOf(after)}`);
    console.log('A PASS');
    host.innerHTML = '';
  }

  console.log('\n===== B: UI patchOsmdRenderForMeasureNumbers (live path) =====');
  {
    const osmd = new OSMD(host, {
      autoResize: false,
      drawTitle: false,
      useXMLMeasureNumbers: true,
    });
    registerOsmdPreviewXmlForArticulation(osmd, xml);
    registerOsmdPreviewXmlForAlign(osmd, xml);
    registerOsmdArticulationFixes(osmd, fixes);
    registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 51 });
    patchOsmdRenderForMeasureNumbers(osmd, host, () => undefined);
    await osmd.load(xml);
    osmd.render(); // patched: enforce UseXML=false, align, apply

    const rules = (osmd as { EngravingRules?: { UseXMLMeasureNumbers?: boolean } }).EngravingRules;
    console.log('B UseXMLMeasureNumbers after patch render =', rules?.UseXMLMeasureNumbers);
    forEachGraphicalMeasure(osmd, (gm) => {
      console.log('B graphic measureMxl=', measureMxlFromGraphic(gm));
    });

    const rows = snapB4(host, 'B after patched render');
    const gap = gapOf(rows);
    const tagged = rows.filter((r) => r.tag).length;
    console.log('B gap', gap, 'tagged', tagged);
    if (gap < 15 || tagged < 2) {
      throw new Error(
        `B FAIL live UI path: gap=${gap} tagged=${tagged}. ` +
          `UseXML=${rules?.UseXMLMeasureNumbers} — apply inside render patch did not separate arts.`,
      );
    }
    console.log('B PASS');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
