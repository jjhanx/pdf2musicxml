/**
 * 증거 전용: (1) OSMD 네이티브 draw가 표별로 Y를 가르는지
 * (2) HITL apply만으로 독립 이동하는지
 * (3) align / dynamics / 재render가 그 결과를 덮는지
 * (4) c0b3 m.51 P1 실데이터 + 다지성부
 *
 * Run: npx tsx _smoke/test_art_draw_isolation.ts
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
import { alignOsmdPreviewNotesByOnsetColumn, registerOsmdPreviewXmlForAlign } from '../src/osmdOnsetColumnAlignFix.ts';
import { applyOsmdDynamicsOffsets, registerOsmdPreviewXmlForDynamics } from '../src/osmdDynamicsOffsetFix.ts';
import { patchOsmdRenderForMeasureNumbers } from '../src/osmdMeasureNumberSuppress.ts';

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

type Row = { tag: string | null; spaces: string | null; visualY: number; shift: string | null };

function snapNote(host: HTMLElement, noteIdx: number, label: string): Row[] {
  const notes = [...host.querySelectorAll('.vf-stavenote')];
  // P1 only preview: notes 0=A4 stacc, 1=B4 target
  const n = notes[noteIdx];
  if (!n) {
    console.log(label, 'NO NOTE', noteIdx, 'total', notes.length);
    return [];
  }
  const arts = findArticulationElementsInStavenote(n);
  const rows: Row[] = arts.map((el) => {
    const start = pathStartXY(el);
    const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?/.exec(el.getAttribute('transform') || '');
    const ty = m ? parseFloat(m[2] ?? '0') : 0;
    return {
      tag: el.getAttribute('data-hitl-art-tag'),
      spaces: el.getAttribute('data-art-spaces'),
      visualY: (start?.y ?? 0) + ty,
      shift: el.getAttribute('data-art-shift-y'),
    };
  });
  console.log(label, JSON.stringify(rows));
  return rows;
}

function gap(rows: Row[]): number {
  if (rows.length < 2) return 0;
  const ys = rows.map((r) => r.visualY).sort((a, b) => a - b);
  return ys[ys.length - 1]! - ys[0]!;
}

function extractP1M51(full: string): string {
  // Minimal score: P1 measures 51 only (keep attributes from part)
  const dom = new JSDOM();
  const parser = new dom.window.DOMParser();
  const doc = parser.parseFromString(full, 'text/xml');
  const p1 = [...doc.getElementsByTagName('part')].find((p) => p.getAttribute('id') === 'P1');
  if (!p1) throw new Error('no P1');
  const m51 = [...p1.getElementsByTagName('measure')].find((m) => m.getAttribute('number') === '51');
  if (!m51) throw new Error('no m51');
  const partList = doc.getElementsByTagName('part-list')[0];
  const scorePart = [...(partList?.getElementsByTagName('score-part') ?? [])].find(
    (s) => s.getAttribute('id') === 'P1',
  );
  const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list>${
    scorePart?.outerHTML ?? '<score-part id="P1"><part-name>S</part-name></score-part>'
  }</part-list><part id="P1">${m51.outerHTML}</part></score-partwise>`;
  return xml;
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

  const scorePath = path.join('D:/pdf2musicxml/_smoke/_c0b3_score.xml');
  const full = fs.readFileSync(scorePath, 'utf8');
  let sample = extractP1M51(full);

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
  sample = applyArticulationPlacementFixesToPreviewXml(sample, fixes);
  sample = prepareArticulationDefaultYForOsmdPreview(sample);

  const host = document.createElement('div');
  host.style.width = '1100px';
  document.body.appendChild(host);

  console.log('\n=== 1) OSMD native draw only (no HITL apply) ===');
  {
    const osmd = new OSMD(host, { autoResize: false, drawTitle: false, useXMLMeasureNumbers: true });
    await osmd.load(sample);
    osmd.render();
    const native = snapNote(host, 1, 'native B4#1');
    console.log('native gap', gap(native), '← OSMD ignores MusicXML default-y; ~10px means stacked');
    if (gap(native) >= 25) {
      console.log('UNEXPECTED: native already separated');
    } else {
      console.log('CONFIRMED: native does NOT place arts by HITL distance');
    }
    host.innerHTML = '';
  }

  console.log('\n=== 2) apply alone ===');
  {
    const osmd = new OSMD(host, { autoResize: false, drawTitle: false, useXMLMeasureNumbers: true });
    registerOsmdPreviewXmlForArticulation(osmd, sample);
    registerOsmdArticulationFixes(osmd, fixes);
    registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 51 });
    await osmd.load(sample);
    osmd.render();
    const st = applyOsmdArticulationOffsetsDetailed(host, osmd);
    const after = snapNote(host, 1, 'after apply');
    console.log('stats', st, 'gap', gap(after));
    if (gap(after) < 25) throw new Error(`apply alone FAIL gap=${gap(after)}`);
    console.log('PASS: apply separates tenuto/accent independently');
    host.innerHTML = '';
  }

  console.log('\n=== 3) apply then align (does align wipe?) ===');
  {
    const osmd = new OSMD(host, { autoResize: false, drawTitle: false, useXMLMeasureNumbers: true });
    registerOsmdPreviewXmlForArticulation(osmd, sample);
    registerOsmdPreviewXmlForAlign(osmd, sample);
    registerOsmdArticulationFixes(osmd, fixes);
    registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 51 });
    await osmd.load(sample);
    osmd.render();
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    const before = snapNote(host, 1, 'before align');
    alignOsmdPreviewNotesByOnsetColumn(osmd);
    alignOsmdPreviewNotesByOnsetColumn(osmd);
    const afterAlign = snapNote(host, 1, 'after align');
    console.log('gap before', gap(before), 'after align', gap(afterAlign));
    if (gap(afterAlign) < 25) {
      console.log('FAIL: align wiped independent art positions');
      throw new Error(`align wipe gap=${gap(afterAlign)}`);
    }
    console.log('PASS: align does not wipe art transforms');
    host.innerHTML = '';
  }

  console.log('\n=== 4) UI patched render path + dynamics after ===');
  {
    const osmd = new OSMD(host, { autoResize: false, drawTitle: false, useXMLMeasureNumbers: true });
    registerOsmdPreviewXmlForArticulation(osmd, sample);
    registerOsmdPreviewXmlForAlign(osmd, sample);
    registerOsmdPreviewXmlForDynamics(osmd, sample);
    registerOsmdArticulationFixes(osmd, fixes);
    registerOsmdPreviewMeasureRangeForArticulation(osmd, { start: 51, end: 51 });
    patchOsmdRenderForMeasureNumbers(osmd, host, () => undefined);
    await osmd.load(sample);
    osmd.render();
    const afterPatch = snapNote(host, 1, 'after patched render');
    applyOsmdDynamicsOffsets(host, osmd, sample, []);
    const afterDyn = snapNote(host, 1, 'after dynamics');
    console.log('gap patch', gap(afterPatch), 'after dyn', gap(afterDyn));
    if (gap(afterDyn) < 25) throw new Error(`dyn wipe gap=${gap(afterDyn)}`);
    console.log('PASS: patched render + dynamics keep separation');
  }

  console.log('\nALL ISOLATION CHECKS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
