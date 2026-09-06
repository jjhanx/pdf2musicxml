/**
 * Multi-part c0b3 m.51 light-preview path — exact OsmdBlock conditions.
 * Run: npx tsx _smoke/test_c0b3_m51_live_path.ts
 */
import { JSDOM } from 'jsdom';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
import { alignOsmdPreviewNotesByOnsetColumn, registerOsmdPreviewXmlForAlign } from '../src/osmdOnsetColumnAlignFix.ts';
import { patchOsmdRenderForMeasureNumbers } from '../src/osmdMeasureNumberSuppress.ts';
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from '../src/osmdMeasureClick.ts';

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

function extractMeasures(full: string, start: number, end: number): string {
  const dom = new JSDOM();
  const doc = new dom.window.DOMParser().parseFromString(full, 'text/xml');
  const partList = doc.getElementsByTagName('part-list')[0];
  const parts = [...doc.getElementsByTagName('part')];
  let body = '';
  for (const part of parts) {
    const pid = part.getAttribute('id');
    const ms = [...part.getElementsByTagName('measure')].filter((m) => {
      const n = Number(m.getAttribute('number'));
      return n >= start && n <= end;
    });
    if (!ms.length) continue;
    body += `<part id="${pid}">${ms.map((m) => m.outerHTML).join('')}</part>`;
  }
  return `<?xml version="1.0"?><score-partwise version="3.1">${partList?.outerHTML ?? ''}${body}</score-partwise>`;
}

function snapP1B4(host: HTMLElement) {
  // text_line 패치 후 네이티브 path Y로 간격 측정 (overlay text 없음)
  const notes = [...host.querySelectorAll('.vf-stavenote')];
  let best: { gap: number; ys: number[] } | null = null;
  for (const n of notes) {
    const arts = findArticulationElementsInStavenote(n);
    if (arts.length < 2) continue;
    const ys = arts
      .map((el) => pathStartXY(el)?.y)
      .filter((y): y is number => y != null)
      .sort((a, b) => a - b);
    if (ys.length < 2) continue;
    const g = ys[ys.length - 1]! - ys[0]!;
    if (!best || g > best.gap) best = { gap: g, ys };
  }
  if (!best) return { error: 'no dual-art note' };
  return best;
}

async function main() {
  const jdom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  Object.assign(globalThis, {
    window: jdom.window,
    document: jdom.window.document,
    DOMParser: jdom.window.DOMParser,
    XMLSerializer: jdom.window.XMLSerializer,
    Node: jdom.window.Node,
    HTMLElement: jdom.window.HTMLElement,
    SVGElement: jdom.window.SVGElement,
    getComputedStyle: jdom.window.getComputedStyle.bind(jdom.window),
  });

  const full = fs.readFileSync(path.join('D:/pdf2musicxml/_smoke/_c0b3_score.xml'), 'utf8');
  const previewXml = extractMeasures(full, 51, 52);
  console.log('preview length', previewXml.length);

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

  const host = document.createElement('div');
  host.style.width = '1200px';
  document.body.appendChild(host);

  // OsmdBlock: xml=previewXml (no arts), load embeds fixes
  const xmlForOsmd = previewXml;
  const xmlForOsmdLoad = prepareArticulationDefaultYForOsmdPreview(
    applyArticulationPlacementFixesToPreviewXml(xmlForOsmd, fixes),
  );

  const osmd = new OSMD(host, {
    autoResize: false,
    drawTitle: false,
    useXMLMeasureNumbers: true,
    drawMeasureNumbers: false,
  });
  registerOsmdPreviewXmlForArticulation(osmd, xmlForOsmdLoad);
  registerOsmdPreviewXmlForAlign(osmd, xmlForOsmd);
  registerOsmdArticulationFixes(osmd, fixes);
  registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 52 });
  patchOsmdRenderForMeasureNumbers(osmd, host, () => undefined);
  await osmd.load(xmlForOsmdLoad);
  osmd.render();

  console.log('graphic measures:');
  forEachGraphicalMeasure(osmd, (gm, si) => {
    console.log(' ', { mxl: measureMxlFromGraphic(gm), part: partIdFromGraphic(gm), staffIndex: si });
  });

  alignOsmdPreviewNotesByOnsetColumn(osmd);
  alignOsmdPreviewNotesByOnsetColumn(osmd);
  const st = applyOsmdArticulationOffsetsDetailed(host, osmd);
  console.log('stats', st);
  let snap = snapP1B4(host);
  console.log('after mount', JSON.stringify(snap, null, 2));
  if (!('gap' in snap) || (snap as any).gap < 25) {
    throw new Error(`FAIL mount ${JSON.stringify(snap)}`);
  }

  // distance-only change (no remount)
  const fixes2 = [
    { ...fixes[0]!, distance: '2' },
    { ...fixes[1]!, distance: '8' },
  ];
  registerOsmdPreviewXmlForArticulation(
    osmd,
    applyArticulationPlacementFixesToPreviewXml(previewXml, fixes2),
  );
  applyPendingArticulationOffsetsOnly(host, osmd, fixes2);
  snap = snapP1B4(host);
  console.log('after distance 2/8', JSON.stringify(snap, null, 2));
  if (!('gap' in snap) || (snap as any).gap < 45) {
    throw new Error(`FAIL distance-only ${JSON.stringify(snap)}`);
  }
  console.log('c0b3 multi-part live path OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
