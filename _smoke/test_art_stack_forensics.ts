/**
 * Deep forensics: m.49 same-dy native stack vs m.51 embed + distance change.
 * Run: npx tsx _smoke/test_art_stack_forensics.ts
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

function snapNote(host: HTMLElement, noteOrd: number, label: string) {
  const notes = [...host.querySelectorAll('.vf-stavenote')];
  const n = notes[noteOrd];
  if (!n) {
    console.log(label, 'NO NOTE', noteOrd, '/', notes.length);
    return null;
  }
  const arts = findArticulationElementsInStavenote(n);
  const paths = arts.map((el, i) => {
    const p = pathStartXY(el);
    const tf = el.getAttribute('transform') || '';
    const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?/.exec(tf);
    const ty = m ? parseFloat(m[2] ?? '0') : 0;
    return {
      i,
      tag: el.getAttribute('data-hitl-art-tag'),
      spaces: el.getAttribute('data-art-spaces'),
      hidden: el.getAttribute('data-hitl-art-hidden'),
      opacity: el.getAttribute('opacity') || (el as any).style?.opacity || '',
      pathY: p?.y ?? null,
      visualY: p ? p.y + ty : null,
      shift: el.getAttribute('data-art-shift-y'),
      d0: (el.getAttribute('d') || '').slice(0, 40),
    };
  });
  const texts = [...host.querySelectorAll('text[data-hitl-art-overlay], text[data-hitl-art-tag]')].map((el) => ({
    tag: el.getAttribute('data-hitl-art-tag') || el.getAttribute('data-hitl-art-overlay'),
    spaces: el.getAttribute('data-art-spaces'),
    x: el.getAttribute('x'),
    y: el.getAttribute('y'),
    text: el.textContent,
    fill: el.getAttribute('fill'),
    fontSize: el.getAttribute('font-size'),
  }));
  const pys = paths.map((p) => p.visualY).filter((y): y is number => y != null).sort((a, b) => a - b);
  const tys = texts.map((t) => parseFloat(t.y || '0')).sort((a, b) => a - b);
  console.log(
    label,
    'nativeGap',
    pys.length >= 2 ? pys[pys.length - 1]! - pys[0]! : 0,
    'overlayGap',
    tys.length >= 2 ? tys[tys.length - 1]! - tys[0]! : 0,
  );
  console.log('  paths', JSON.stringify(paths));
  console.log('  texts', JSON.stringify(texts));
  return { paths, texts, nativeGap: pys.length >= 2 ? pys[pys.length - 1]! - pys[0]! : 0 };
}

async function render(xml: string, fixes: any[], range: { start: number; end: number }) {
  const host = document.createElement('div');
  host.style.width = '1000px';
  document.body.appendChild(host);
  const loadXml = prepareArticulationDefaultYForOsmdPreview(xml);
  const osmd = new OSMD(host, { autoResize: false, drawTitle: false, useXMLMeasureNumbers: true });
  registerOsmdPreviewXmlForArticulation(osmd, loadXml);
  registerOsmdArticulationFixes(osmd, fixes);
  registerOsmdPreviewMeasureRangeForArticulation(osmd, range);
  await osmd.load(loadXml);
  osmd.render();
  return { host, osmd };
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

  console.log('\n======== A. m.49 raw XML (both default-y=-10, NO HITL) ========');
  {
    const xml = extract(full, 49, 49);
    const { host } = await render(xml, [], { start: 49, end: 49 });
    snapNote(host, 0, 'm49-raw');
    host.remove();
  }

  console.log('\n======== B. m.49 after HITL apply distances both auto/1 ========');
  {
    const base = extract(full, 49, 49);
    const fixes = [
      { kind: 'setArticulationPlacement', partId: 'P1', measureMxl: '49', noteIndex: 0, articulation: 'tenuto', placement: 'below', distance: '1', pitchStep: 'A', pitchOctave: 3 },
      { kind: 'setArticulationPlacement', partId: 'P1', measureMxl: '49', noteIndex: 0, articulation: 'accent', placement: 'below', distance: '1', pitchStep: 'A', pitchOctave: 3 },
    ];
    const xml = applyArticulationPlacementFixesToPreviewXml(base, fixes);
    const { host, osmd } = await render(xml, fixes, { start: 49, end: 49 });
    snapNote(host, 0, 'm49-before-apply');
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    snapNote(host, 0, 'm49-after-apply-1/1');
    // change accent to 8 without remount
    const fixes2 = [
      { ...fixes[0]! },
      { ...fixes[1]!, distance: '8' },
    ];
    const xml2 = applyArticulationPlacementFixesToPreviewXml(base, fixes2);
    registerOsmdPreviewXmlForArticulation(osmd, xml2);
    applyPendingArticulationOffsetsOnly(host, osmd, fixes2);
    snapNote(host, 0, 'm49-distance-only-1/8');
    host.remove();
  }

  console.log('\n======== C. m.51 HITL embed like UI (xml=hintXml) 2/6 ========');
  {
    const base = extract(full, 51, 52);
    const fixes = [
      { kind: 'addArticulation', partId: 'P1', measureMxl: '51', noteIndex: 1, articulation: 'tenuto', placement: 'below', distance: '2', pitchStep: 'B', pitchOctave: 4 },
      { kind: 'addArticulation', partId: 'P1', measureMxl: '51', noteIndex: 1, articulation: 'accent', placement: 'below', distance: '6', pitchStep: 'B', pitchOctave: 4 },
    ];
    const xml = applyArticulationPlacementFixesToPreviewXml(base, fixes);
    const { host, osmd } = await render(xml, fixes, { start: 51, end: 52 });
    snapNote(host, 1, 'm51-embed-before-apply');
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    snapNote(host, 1, 'm51-embed-after-apply-2/6');
    const fixes2 = [
      { ...fixes[0]! },
      { ...fixes[1]!, distance: '8' },
    ];
    const xml2 = applyArticulationPlacementFixesToPreviewXml(base, fixes2);
    registerOsmdPreviewXmlForArticulation(osmd, prepareArticulationDefaultYForOsmdPreview(xml2));
    applyPendingArticulationOffsetsOnly(host, osmd, fixes2);
    snapNote(host, 1, 'm51-distance-only-2/8');
    host.remove();
  }

  console.log('\n======== D. m.51 remount path (new OSMD) distance 2/8 ========');
  {
    const base = extract(full, 51, 52);
    const fixes = [
      { kind: 'addArticulation', partId: 'P1', measureMxl: '51', noteIndex: 1, articulation: 'tenuto', placement: 'below', distance: '2', pitchStep: 'B', pitchOctave: 4 },
      { kind: 'addArticulation', partId: 'P1', measureMxl: '51', noteIndex: 1, articulation: 'accent', placement: 'below', distance: '8', pitchStep: 'B', pitchOctave: 4 },
    ];
    const xml = applyArticulationPlacementFixesToPreviewXml(base, fixes);
    const { host, osmd } = await render(xml, fixes, { start: 51, end: 52 });
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    snapNote(host, 1, 'm51-remount-2/8');
    host.remove();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
