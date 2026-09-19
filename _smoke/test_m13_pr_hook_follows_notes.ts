/**
 * m13 PR: 조표 침범 평행 시프트 후 짧은 hook 빔이 음표와 같이 움직여야 함.
 * Run: npx tsx _smoke/test_m13_pr_hook_follows_notes.ts
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
  '<!DOCTYPE html><html><body><div id="host" style="width:2200px;height:1200px"></div></body></html>',
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
}

function beamPathWidth(beam: Element): number | null {
  const path = beam.querySelector('path');
  const d = path?.getAttribute('d');
  if (!d) return null;
  const xs: number[] = [];
  const re = /[MmLl]\s*([-\d.eE+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const n = parseFloat(m[1]!);
    if (Number.isFinite(n)) xs.push(n);
  }
  if (xs.length < 2) return null;
  return Math.max(...xs) - Math.min(...xs);
}

function readTx(el: Element): number {
  const tr = el.getAttribute('transform') ?? '';
  const m = /translate\(\s*([-\d.]+)/.exec(tr);
  return m ? parseFloat(m[1]!) : 0;
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
    </part-list></score-partwise>`,
    'text/xml',
  );
  const part = p5.cloneNode(true) as Element;
  part.setAttribute('id', 'P5__PR');
  for (const m of [...part.children]) {
    if (local(m as Element) !== 'measure') continue;
    const n = parseInt((m as Element).getAttribute('number') || '0', 10);
    if (n < 12 || n > 14) {
      m.remove();
      continue;
    }
    transformStaff(m as Element, 1);
  }
  doc.documentElement!.appendChild(part);
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
  alignOsmdPreviewNotesByOnsetColumn(osmd, xml);
  alignOsmdPreviewNotesByOnsetColumn(osmd, xml);

  let shortHooks = 0;
  let stranded = 0;
  let noteDxSample: number | undefined;
  forEachGraphicalMeasure(osmd, (gm) => {
    if (measureMxlFromGraphic(gm) !== 13) return;
    if (partIdFromGraphic(gm) !== 'P5__PR') return;
    const noteDxs: number[] = [];
    let mg: Element | null = null;
    const seen = new Set<Element>();
    for (const se of (gm as any).staffEntries ?? []) {
      for (const gve of se.graphicalVoiceEntries ?? []) {
        for (const gn of gve.notes ?? []) {
          let el: Element | null = null;
          try {
            el = osmd.EngravingRules?.GNote?.(gn.sourceNote ?? gn.SourceNote)?.getSVGGElement?.() ?? null;
          } catch {
            /* */
          }
          const sn = el?.closest?.('.vf-stavenote') ?? el;
          if (!sn || seen.has(sn)) continue;
          seen.add(sn);
          noteDxs.push(readTx(sn));
          mg = sn.closest('.vf-measure');
        }
      }
    }
    if (!mg || !noteDxs.length) return;
    noteDxSample = noteDxs[0];
    for (const beam of mg.querySelectorAll('.vf-beam')) {
      const w = beamPathWidth(beam);
      if (w == null || w >= 12) continue;
      shortHooks += 1;
      const bdx = readTx(beam);
      const nearest = noteDxs.reduce((best, d) =>
        Math.abs(d - bdx) < Math.abs(best - bdx) ? d : best,
      );
      if (Math.abs(bdx - nearest) > 2.5) stranded += 1;
    }
  });

  console.log({ shortHooks, stranded, noteDxSample });
  if (shortHooks < 1) throw new Error('expected short hook beams on PR m13');
  if (stranded > 0) throw new Error(`${stranded} short hooks stranded away from nearest note dx`);
  console.log('OK m13 PR hook follows notes');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
