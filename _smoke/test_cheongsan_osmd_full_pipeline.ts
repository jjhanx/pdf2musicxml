/**
 * 청산 26마디 — buildOsmdPreviewXml + sanitize + OSMD render 전체 파이프라인
 * Run: npx tsx _smoke/test_cheongsan_osmd_full_pipeline.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import {
  buildOsmdPreviewXml,
  removeAudiverisMeasureNumberingForOsmd,
  stripSpuriousMeasureNumberWordsForOsmd,
} from '../src/AudiverisInspectPanel.tsx';
import { removeDanglingTimelineElementsForOsmdPreview, countDanglingTimelineElements } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:1400px;height:4000px;position:relative"></div></body></html>',
);
const g = globalThis as unknown as Record<string, unknown>;
g.document = dom.window.document;
g.window = dom.window;
g.navigator = dom.window.navigator;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;
g.SVGElement = dom.window.SVGElement;
g.requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
};

function loadCheongsanXml(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AdmZip = require('adm-zip') as typeof import('adm-zip');
  const path = '청산에 살리라 F/_inspect_0ea5/review.mxl';
  const zip = new AdmZip(path);
  const entry = zip
    .getEntries()
    .find((e) => e.entryName.endsWith('.xml') && !e.entryName.toUpperCase().includes('META'));
  if (!entry) throw new Error('no xml');
  return entry.getData().toString('utf8');
}

function countM26Notes(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
  let n = 0;
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '';
    if (!/^P[1-5]/.test(pid)) continue;
    const meas = [...part.children].find(
      (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '26',
    );
    if (!meas) continue;
    n += [...meas.children].filter((c) => local(c as Element) === 'note').length;
  }
  return n;
}

function sanitizeLikeOsmdBlock(xml: string, verbatim: boolean): string {
  let out = xml;
  out = repairRestDisplayForOsmdPreview(out);
  out = removeDanglingTimelineElementsForOsmdPreview(out);
  out = removeAudiverisMeasureNumberingForOsmd(out);
  out = stripSpuriousMeasureNumberWordsForOsmd(out, new Map());
  if (!verbatim) {
    // skipped in HITL verbatim
  }
  return out;
}

async function main() {
  const raw = loadCheongsanXml();
  const scoreParts = [
    { id: 'P1', displayLabel: 'S' },
    { id: 'P2', displayLabel: 'A' },
    { id: 'P3', displayLabel: 'T' },
    { id: 'P4', displayLabel: 'B' },
    { id: 'P5', displayLabel: 'P' },
  ];

  console.log('raw dangling', countDanglingTimelineElements(raw));
  const preview = buildOsmdPreviewXml(raw, scoreParts, null, { verbatim: true });
  console.log('preview dangling before sanitize', countDanglingTimelineElements(preview));
  const sanitized = sanitizeLikeOsmdBlock(preview, true);
  console.log('preview dangling after sanitize', countDanglingTimelineElements(sanitized));
  console.log('m26 notes in sanitized preview', countM26Notes(sanitized));

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    drawComposer: false,
    drawMeasureNumbers: false,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);

  await osmd.load(sanitized);
  osmd.zoom = 0.45;
  osmd.render();

  const sheet = osmd.GraphicSheet as {
    MeasureList?: Array<{
      MeasureNumber?: number;
      measureNumber?: number;
      staffEntries?: unknown[];
      VerticalSourceStaffEntryContainers?: unknown[];
    }>;
  } | undefined;

  const measures = sheet?.MeasureList ?? [];
  const byNum = new Map<number, { count: number; parts: number }>();
  for (const m of measures) {
    const num = Number(m.MeasureNumber ?? m.measureNumber ?? 0);
    const entries = (m.staffEntries ?? m.VerticalSourceStaffEntryContainers ?? []) as unknown[];
    const prev = byNum.get(num) ?? { count: 0, parts: 0 };
    byNum.set(num, { count: prev.count + entries.length, parts: prev.parts + 1 });
  }

  for (const n of [24, 25, 26, 27, 28]) {
    const v = byNum.get(n);
    console.log(`graphic m${n}`, v ?? 'MISSING');
  }

  const m26Measures = measures.filter((m) => Number(m.MeasureNumber ?? m.measureNumber) === 26);
  const empty26 = m26Measures.filter((m) => {
    const entries = (m.staffEntries ?? m.VerticalSourceStaffEntryContainers ?? []) as unknown[];
    return entries.length === 0;
  });
  if (empty26.length > 0) {
    throw new Error(`OSMD m26 has ${empty26.length} empty staff measures out of ${m26Measures.length}`);
  }
  if ((byNum.get(26)?.count ?? 0) < 4) {
    throw new Error(`OSMD m26 staffEntries too low: ${byNum.get(26)?.count ?? 0}`);
  }
  console.log('cheongsan full pipeline ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
