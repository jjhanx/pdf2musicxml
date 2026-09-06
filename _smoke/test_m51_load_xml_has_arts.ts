/**
 * UI와 동일: pending 표를 load XML에 심은 뒤 OSMD load (m.49와 같은 경로).
 * Run: npx tsx _smoke/test_m51_load_xml_has_arts.ts
 */
import { JSDOM } from 'jsdom';
import * as fs from 'node:fs';
import * as path from 'node:path';
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

  // OmrStaffReviewPanel: xml={articulationHintXml}
  const articulationHintXml = applyArticulationPlacementFixesToPreviewXml(previewXml, fixes);
  if (!/<tenuto[\s>]/.test(articulationHintXml) || !/<accent[\s>]/.test(articulationHintXml)) {
    throw new Error('FAIL: articulationHintXml missing tenuto/accent (m.49-parity inject)');
  }
  if (!articulationHintXml.includes('data-hitl-art-distance="2"') || !articulationHintXml.includes('data-hitl-art-distance="6"')) {
    throw new Error('FAIL: distances not embedded in load XML');
  }

  const xmlForOsmdLoad = prepareArticulationDefaultYForOsmdPreview(articulationHintXml);
  const host = document.createElement('div');
  host.style.width = '1200px';
  document.body.appendChild(host);
  const osmd = new OSMD(host, {
    autoResize: false,
    drawTitle: false,
    useXMLMeasureNumbers: true,
  });
  registerOsmdPreviewXmlForArticulation(osmd, xmlForOsmdLoad);
  registerOsmdArticulationFixes(osmd, fixes);
  registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 52 });
  await osmd.load(xmlForOsmdLoad);
  osmd.render();

  // load XML에 표가 있으면 네이티브 path가 생겨야 함 (m.49와 동일)
  const notes = [...host.querySelectorAll('.vf-stavenote')];
  let dual = 0;
  for (const n of notes) {
    const arts = findArticulationElementsInStavenote(n);
    if (arts.length >= 2) dual += 1;
  }
  if (dual < 1) {
    throw new Error(`FAIL: expected native dual arts after load-with-embedded-XML, dualNotes=${dual}`);
  }

  applyOsmdArticulationOffsetsDetailed(host, osmd);
  const texts = [...host.querySelectorAll('text[data-hitl-art-tag]')];
  const ten = texts.find((t) => t.getAttribute('data-hitl-art-tag') === 'tenuto');
  const acc = texts.find((t) => t.getAttribute('data-hitl-art-tag') === 'accent');
  if (!ten || !acc) throw new Error(`FAIL overlay texts ${texts.length}`);
  const gap = Math.abs(parseFloat(acc.getAttribute('y') || '0') - parseFloat(ten.getAttribute('y') || '0'));
  if (gap < 35) throw new Error(`FAIL gap ${gap} (want ~40 for 2 vs 6)`);

  console.log('m51 load-xml-has-arts OK', { dualNativeNotes: dual, overlayGap: gap });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
