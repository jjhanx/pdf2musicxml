/**
 * PR+PL split 시스템에서 m13 PL 4분음 간격이 균등해야 함.
 * (이전: partIdsMatch가 PR↔PL을 섞고, PL staffIdx=1이라 staff 필터가 비어 정렬 스킵)
 * Run: npx tsx _smoke/test_pr_pl_onset_beat_spacing.ts
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
  stripMeasureWidthAttributesForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from '../src/osmdMeasureClick';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:2200px;height:2800px"></div></body></html>',
  { pretendToBeVisual: true },
);
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => (el.localName || el.tagName).toLowerCase().replace(/^.*:/, '');
function noteStaffN(n: Element): number {
  const t = n.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim();
  return Number.isFinite(parseInt(t || '1', 10)) ? parseInt(t || '1', 10) : 1;
}

function transformStaff(measure: Element, staffN: number): void {
  for (const child of [...measure.children]) {
    if (local(child) === 'note' && noteStaffN(child) !== staffN) child.remove();
  }
  let seenNote = false;
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'note') {
      seenNote = true;
      continue;
    }
    if (tag !== 'attributes') continue;
    let staves = [...child.children].find((c) => local(c) === 'staves');
    if (!seenNote) {
      if (!staves) {
        staves = measure.ownerDocument!.createElement('staves');
        child.insertBefore(staves, child.firstChild);
      }
      staves.textContent = '1';
    } else if (staves) staves.remove();
    for (const clef of [...child.children].filter((c) => local(c) === 'clef')) {
      const num = parseInt(clef.getAttribute('number') ?? '1', 10);
      if (num !== staffN) clef.remove();
      else clef.setAttribute('number', '1');
    }
  }
  pruneCrossStaffTimelineForOsmdPreview(measure, staffN);
  measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
    el.textContent = '1';
  });
}

function noteheadCenterX(sn: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of sn.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    let tx = 0;
    let cur: Element | null = path;
    while (cur) {
      const tr = cur.getAttribute?.('transform') ?? '';
      const tm = /translate\(\s*([-\d.]+)/.exec(tr);
      if (tm) tx += parseFloat(tm[1]!);
      cur = cur.parentElement;
    }
    xs.push(tx + parseFloat(m[1]!));
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function plGaps(osmd: any, measureNumber: number): number[] {
  const xs: number[] = [];
  const seen = new Set<SVGGraphicsElement>();
  forEachGraphicalMeasure(osmd, (gm) => {
    if (measureMxlFromGraphic(gm) !== measureNumber) return;
    if (partIdFromGraphic(gm) !== 'P5__PL') return;
    for (const se of (gm as any).staffEntries ?? []) {
      for (const gve of se.graphicalVoiceEntries ?? []) {
        for (const gn of gve.notes ?? []) {
          const src = gn.sourceNote ?? gn.SourceNote;
          let el: SVGGraphicsElement | null = null;
          try {
            el = osmd.EngravingRules?.GNote?.(src)?.getSVGGElement?.() ?? null;
          } catch {
            /* */
          }
          if (!el) continue;
          const sn = el.classList?.contains?.('vf-stavenote')
            ? el
            : (el.closest?.('.vf-stavenote') as SVGGraphicsElement | null);
          if (!sn || seen.has(sn)) continue;
          seen.add(sn);
          const x = noteheadCenterX(sn);
          if (x != null) xs.push(x);
        }
      }
    }
  });
  xs.sort((a, b) => a - b);
  return xs.slice(1).map((x, i) => x - xs[i]!);
}

function gapCv(gaps: number[]): number | null {
  if (gaps.length < 2) return null;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (Math.abs(mean) < 1e-9) return null;
  const v = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(v) / Math.abs(mean);
}

async function main(): Promise<void> {
  if (!OSMD) throw new Error('no OSMD');
  const buf = fs.readFileSync('omr-work-6895627c.zip');
  const z = await JSZip.loadAsync(buf);
  const mxl = await z.file('review.mxl')!.async('nodebuffer');
  const inner = await JSZip.loadAsync(mxl);
  const name = Object.keys(inner.files).find((n) => n.endsWith('.xml') && !n.toUpperCase().includes('META'))!;
  let xml = await inner.file(name)!.async('string');
  xml = repairTimelineForOsmdPreview(xml, { faithfulEditorLayout: true });

  const src = new DOMParser().parseFromString(xml, 'text/xml');
  const p5 = [...src.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
  const doc = new DOMParser().parseFromString(
    `<?xml version="1.0"?><score-partwise version="3.1"><part-list>
      <score-part id="P5__PR"><part-name>PR</part-name></score-part>
      <score-part id="P5__PL"><part-name>PL</part-name></score-part>
    </part-list></score-partwise>`,
    'text/xml',
  );
  const root = doc.documentElement!;
  for (const staffN of [1, 2] as const) {
    const part = p5.cloneNode(true) as Element;
    part.setAttribute('id', staffN === 1 ? 'P5__PR' : 'P5__PL');
    for (const m of [...part.children]) {
      if (local(m as Element) !== 'measure') continue;
      const n = parseInt((m as Element).getAttribute('number') || '0', 10);
      if (n < 12 || n > 14) {
        m.remove();
        continue;
      }
      transformStaff(m as Element, staffN);
    }
    root.appendChild(part);
  }
  xml = new XMLSerializer().serializeToString(doc);
  xml = repairTimelineForOsmdPreview(xml, { faithfulEditorLayout: true });
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = stripMeasureWidthAttributesForOsmdPreview(xml);
  xml = stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml);

  const host = document.getElementById('host')!;
  const osmd = new OSMD!(host, { autoResize: false, drawTitle: false, alignRests: 0 });
  if (typeof osmd.EngravingRules.SoftmaxFactorVexFlow === 'number') {
    osmd.EngravingRules.SoftmaxFactorVexFlow = Math.max(osmd.EngravingRules.SoftmaxFactorVexFlow, 100);
  }
  registerOsmdPreviewXmlForAlign(osmd, xml);
  await osmd.load(xml);
  osmd.zoom = 0.5;
  osmd.render();

  const before = gapCv(plGaps(osmd, 13));
  alignOsmdPreviewNotesByOnsetColumn(osmd, xml);
  alignOsmdPreviewNotesByOnsetColumn(osmd, xml);
  const gaps = plGaps(osmd, 13);
  const after = gapCv(gaps);
  console.log(
    'PL m13 gaps beforeCV=',
    before?.toFixed(3),
    'after=',
    gaps.map((g) => g.toFixed(1)).join(','),
    'cv=',
    after?.toFixed(3),
  );
  if (gaps.length < 3) throw new Error(`expected 3 PL quarter gaps, got ${gaps.length}`);
  if (after == null || after > 0.05) {
    throw new Error(`PL m13 quarter gaps not equal: cv=${after} gaps=${gaps.join(',')}`);
  }
  console.log('OK pr/pl onset beat spacing');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
