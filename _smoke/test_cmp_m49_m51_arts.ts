/**
 * Compare m.49 #0 A3 (XML에 tenuto+accent) vs m.51 #1 B4 (HITL로 추가) 표 Y.
 * Run: npx tsx _smoke/test_cmp_m49_m51_arts.ts
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
import { pathStartXY } from '../src/osmdArticulationOverlay.ts';
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

function snapNative(host: HTMLElement, noteOrdinalInSvg: number, label: string) {
  const notes = [...host.querySelectorAll('.vf-stavenote')];
  // For P1-only we'd use note index; multi-part: find by scanning arts count
  const n = notes[noteOrdinalInSvg];
  if (!n) {
    console.log(label, 'NO NOTE', noteOrdinalInSvg, 'total', notes.length);
    return [];
  }
  const arts = findArticulationElementsInStavenote(n);
  const rows = arts.map((el, i) => {
    const start = pathStartXY(el);
    const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?/.exec(el.getAttribute('transform') || '');
    const ty = m ? parseFloat(m[2] ?? '0') : 0;
    return {
      i,
      tag: el.getAttribute('data-hitl-art-tag') || el.getAttribute('data-hitl-art-overlay'),
      spaces: el.getAttribute('data-art-spaces'),
      pathY: start?.y ?? null,
      visualY: (start?.y ?? 0) + ty,
      shift: el.getAttribute('data-art-shift-y'),
      opacity: el.getAttribute('opacity') || (el as any).style?.opacity,
      hidden: el.getAttribute('data-hitl-art-hidden'),
    };
  });
  const ys = rows.map((r) => r.visualY).sort((a, b) => a - b);
  const gap = ys.length >= 2 ? ys[ys.length - 1]! - ys[0]! : 0;
  console.log(label, 'gap', gap, JSON.stringify(rows));
  return { rows, gap };
}

function snapOverlays(host: HTMLElement, label: string) {
  const texts = [...host.querySelectorAll('text[data-hitl-art-tag], text[data-hitl-art-overlay]')];
  const rows = texts.map((el) => ({
    tag: el.getAttribute('data-hitl-art-tag') || el.getAttribute('data-hitl-art-overlay'),
    spaces: el.getAttribute('data-art-spaces'),
    y: parseFloat(el.getAttribute('y') || '0'),
    x: parseFloat(el.getAttribute('x') || '0'),
    text: el.textContent,
  }));
  console.log(label, 'overlays', JSON.stringify(rows));
  return rows;
}

async function boot(xml: string, fixes: any[], range: { start: number; end: number }) {
  const host = document.createElement('div');
  host.style.width = '1400px';
  document.body.appendChild(host);
  const loadXml = prepareArticulationDefaultYForOsmdPreview(
    fixes.length ? applyArticulationPlacementFixesToPreviewXml(xml, fixes) : xml,
  );
  const osmd = new OSMD(host, {
    autoResize: false,
    drawTitle: false,
    useXMLMeasureNumbers: true,
  });
  registerOsmdPreviewXmlForArticulation(osmd, loadXml);
  registerOsmdArticulationFixes(osmd, fixes);
  registerOsmdPreviewMeasureRangeForArticulation(osmd, range);
  await osmd.load(loadXml);
  osmd.render();
  return { host, osmd, loadXml };
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

  // --- m49: arts already in XML ---
  console.log('\n======== m.49 #0 A3 (XML에 tenuto+accent 이미 있음) ========');
  {
    const xml = extractMeasures(full, 49, 49);
    // P1 only for clean note index
    const dom = new JSDOM();
    const doc = new dom.window.DOMParser().parseFromString(xml, 'text/xml');
    const p1 = [...doc.getElementsByTagName('part')].find((p) => p.getAttribute('id') === 'P1')!;
    const pl = doc.getElementsByTagName('part-list')[0];
    const sp = [...pl.getElementsByTagName('score-part')].find((s) => s.getAttribute('id') === 'P1');
    const p1xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list>${sp!.outerHTML}</part-list><part id="P1">${
      [...p1.getElementsByTagName('measure')].map((m) => m.outerHTML).join('')
    }</part></score-partwise>`;

    const { host, osmd } = await boot(p1xml, [], { start: 49, end: 49 });
    console.log('graphic', measureMxlFromGraphic);
    forEachGraphicalMeasure(osmd, (gm) => {
      console.log(' gm', measureMxlFromGraphic(gm), partIdFromGraphic(gm));
    });
    const native = snapNative(host, 0, 'm49 native #0');
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    snapNative(host, 0, 'm49 after HITL apply #0');
    snapOverlays(host, 'm49');
    console.log('m49 SUMMARY nativeGap', native.gap);
    host.remove();
  }

  // --- m51: empty B4, HITL add tenuto+accent ---
  console.log('\n======== m.51 #1 B4 (XML에 표 없음 → HITL add) ========');
  {
    const xml = extractMeasures(full, 51, 51);
    const dom = new JSDOM();
    const doc = new dom.window.DOMParser().parseFromString(xml, 'text/xml');
    const p1 = [...doc.getElementsByTagName('part')].find((p) => p.getAttribute('id') === 'P1')!;
    const pl = doc.getElementsByTagName('part-list')[0];
    const sp = [...pl.getElementsByTagName('score-part')].find((s) => s.getAttribute('id') === 'P1');
    const p1xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list>${sp!.outerHTML}</part-list><part id="P1">${
      [...p1.getElementsByTagName('measure')].map((m) => m.outerHTML).join('')
    }</part></score-partwise>`;

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
        distance: '2', // SAME distance as often happens before stack — or user left both similar
        pitchStep: 'B',
        pitchOctave: 4,
      },
    ];

    // Case A: both distance 2 (same) — what stack does
    console.log('--- HITL add both distance=2 (same) ---');
    let { host, osmd } = await boot(p1xml, fixes, { start: 51, end: 51 });
    snapNative(host, 1, 'm51 native after load(embed) #1');
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    snapNative(host, 1, 'm51 after apply same-dist #1');
    snapOverlays(host, 'm51 same-dist');
    host.remove();

    // Case B: stacked 2 vs 4 like suggestStacked +2
    console.log('--- HITL add distance 2 vs 4 (stack +2) ---');
    const fixes2 = [
      { ...fixes[0]!, distance: '2' },
      { ...fixes[1]!, distance: '4' },
    ];
    ({ host, osmd } = await boot(p1xml, fixes2, { start: 51, end: 51 }));
    snapNative(host, 1, 'm51 native embed 2/4 #1');
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    snapNative(host, 1, 'm51 after apply 2/4 #1');
    snapOverlays(host, 'm51 2/4');
    host.remove();

    // Case C: no HITL apply — only OSMD native after embed (like before our overlay)
    console.log('--- embed only, NO apply (old collapse path components) ---');
    ({ host, osmd } = await boot(p1xml, fixes2, { start: 51, end: 51 }));
    const nativeOnly = snapNative(host, 1, 'm51 embed-only native #1');
    console.log('m51 SUMMARY embed-only nativeGap', nativeOnly.gap);
    host.remove();
  }

  // --- m49 with SAME default-y both — why visible? ---
  console.log('\n======== 해석 ========');
  console.log(
    'm49: XML에 두 표가 처음부터 있음 → OSMD/VexFlow가 자체 스택(~10px)으로 그림 → 눈으로 차이 있음',
  );
  console.log(
    'm51: HITL이 나중에 넣음 → load embed 후 네이티브도 ~10px이나, 잘못된 상대 HITL 이동이 상쇄하면 gap≈0',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
