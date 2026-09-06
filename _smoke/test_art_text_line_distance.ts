/**
 * text_line 패치: 거리 변경이 네이티브 path Y에 반영되는지.
 * Run: npx tsx _smoke/test_art_text_line_distance.ts
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

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

function extract(full: string, start: number, end: number): string {
  const dom = new JSDOM();
  const doc = new dom.window.DOMParser().parseFromString(full, 'text/xml');
  const partList = doc.getElementsByTagName('part-list')[0];
  let body = '';
  for (const part of [...doc.getElementsByTagName('part')]) {
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

function nativeGap(host: HTMLElement, noteOrd: number): number {
  const notes = [...host.querySelectorAll('.vf-stavenote')];
  const arts = findArticulationElementsInStavenote(notes[noteOrd]!);
  const ys = arts
    .map((el) => pathStartXY(el)?.y)
    .filter((y): y is number => y != null)
    .sort((a, b) => a - b);
  if (ys.length < 2) return 0;
  return ys[ys.length - 1]! - ys[0]!;
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
  const base = extract(full, 51, 52);
  const mk = (d1: string, d2: string) => [
    {
      kind: 'addArticulation' as const,
      partId: 'P1',
      measureMxl: '51',
      noteIndex: 1,
      articulation: 'tenuto',
      placement: 'below' as const,
      distance: d1,
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
      distance: d2,
      pitchStep: 'B',
      pitchOctave: 4,
    },
  ];

  const fixes26 = mk('2', '6');
  const xml26 = prepareArticulationDefaultYForOsmdPreview(
    applyArticulationPlacementFixesToPreviewXml(base, fixes26),
  );
  const host = document.createElement('div');
  host.style.width = '1200px';
  document.body.appendChild(host);
  const osmd = new OSMD(host, { autoResize: false, drawTitle: false, useXMLMeasureNumbers: true });
  registerOsmdPreviewXmlForArticulation(osmd, xml26);
  registerOsmdArticulationFixes(osmd, fixes26);
  registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 52 });
  await osmd.load(xml26);
  osmd.render();
  const gapBefore = nativeGap(host, 1);
  const stats = applyOsmdArticulationOffsetsDetailed(host, osmd);
  const gap26 = nativeGap(host, 1);
  console.log({ gapBefore, gap26, stats });

  if (gap26 < 25) {
    throw new Error(`FAIL 2/6 gap too small: ${gap26} (want ~40 from text_line)`);
  }

  const fixes28 = mk('2', '8');
  const xml28 = prepareArticulationDefaultYForOsmdPreview(
    applyArticulationPlacementFixesToPreviewXml(base, fixes28),
  );
  registerOsmdPreviewXmlForArticulation(osmd, xml28);
  applyPendingArticulationOffsetsOnly(host, osmd, fixes28);
  const gap28 = nativeGap(host, 1);
  console.log({ gap28 });
  if (gap28 < gap26 + 10) {
    throw new Error(`FAIL distance 6→8 no increase: ${gap26} → ${gap28}`);
  }

  // remount-like reload
  host.innerHTML = '';
  const osmd2 = new OSMD(host, { autoResize: false, drawTitle: false, useXMLMeasureNumbers: true });
  registerOsmdPreviewXmlForArticulation(osmd2, xml28);
  registerOsmdArticulationFixes(osmd2, fixes28);
  registerOsmdPreviewMeasureRangeForArticulation(osmd2, { start: 51, end: 52 });
  await osmd2.load(xml28);
  osmd2.render();
  applyOsmdArticulationOffsetsDetailed(host, osmd2);
  const gapRemount = nativeGap(host, 1);
  console.log({ gapRemount });
  if (gapRemount < 35) throw new Error(`FAIL remount gap ${gapRemount}`);

  console.log('text_line distance OK', { gap26, gap28, gapRemount });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
