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
  // overlay는 svg 루트에 붙음 — text만 신뢰 (path 태그는 다른 음 잔여일 수 있음)
  const tagged = [...host.querySelectorAll('text[data-hitl-art-tag], text[data-hitl-art-overlay]')];
  const rows = tagged.map((el) => {
    const tag = el.getAttribute('data-hitl-art-tag') || el.getAttribute('data-hitl-art-overlay');
    return {
      tag,
      spaces: el.getAttribute('data-art-spaces'),
      visualY: parseFloat(el.getAttribute('y') || '0'),
      shift: el.getAttribute('data-art-shift-y'),
    };
  });
  const tenutos = rows.filter((r) => r.tag === 'tenuto');
  const accents = rows.filter((r) => r.tag === 'accent');
  if (!tenutos.length || !accents.length) {
    return { error: 'missing tenuto/accent text overlay', rows, taggedCount: tagged.length };
  }
  // 같은 noteHead 추정: visualY - spaces*10 이 가까운 쌍
  let best: { rows: typeof rows; gap: number } | null = null;
  for (const t of tenutos) {
    const tHead = t.visualY - (parseFloat(t.spaces || '0') || 0) * 10;
    for (const a of accents) {
      const aHead = a.visualY - (parseFloat(a.spaces || '0') || 0) * 10;
      if (Math.abs(tHead - aHead) > 5) continue;
      const g = Math.abs(t.visualY - a.visualY);
      if (!best || g > best.gap) best = { rows: [t, a], gap: g };
    }
  }
  if (!best) {
    return { error: 'no same-notehead tenuto/accent pair', rows };
  }
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
  const accent = (snap as any).rows?.find((r: { tag: string }) => r.tag === 'accent');
  if (accent?.spaces !== '8') {
    throw new Error(`FAIL accent spaces want 8 got ${accent?.spaces}`);
  }
  console.log('c0b3 multi-part live path OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
