/**
 * m13: primary beams (≥18px, 8분 연결) ends must meet stem tips within 1.5px.
 * Run: npx tsx _smoke/test_m13_eighth_beam_tips.ts
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
import { applyPlayOrderLayoutToXml } from '../shared/musicXmlPlayOrder';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from '../src/osmdMeasureClick';

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

async function loadXml(): Promise<string> {
  const buf = fs.readFileSync('omr-work-6895627c.zip');
  const z = await JSZip.loadAsync(buf);
  const mxl = await z.file('review.mxl')!.async('nodebuffer');
  const inner = await JSZip.loadAsync(mxl);
  const name = Object.keys(inner.files).find((n) => n.endsWith('.xml') && !n.toUpperCase().includes('META'))!;
  let xml = await inner.file(name)!.async('string');
  xml = repairTimelineForOsmdPreview(xml, { faithfulEditorLayout: true });
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = applyPlayOrderLayoutToXml(xml);
  xml = stripMeasureWidthAttributesForOsmdPreview(xml);
  xml = stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  for (const part of [...doc.querySelectorAll('part')]) {
    if (part.getAttribute('id') !== 'P5') part.remove();
  }
  for (const sp of [...doc.querySelectorAll('score-part')]) {
    if (sp.getAttribute('id') !== 'P5') sp.remove();
  }
  const part = doc.querySelector('part')!;
  for (const m of [...part.children]) {
    const tag = ((m as Element).localName || '').toLowerCase();
    if (tag !== 'measure') continue;
    const n = parseInt((m as Element).getAttribute('number') || '0', 10);
    if (n < 12 || n > 14) m.remove();
  }
  return '<?xml version="1.0"?>' + new XMLSerializer().serializeToString(doc);
}

function pathXs(d: string): number[] {
  const xs: number[] = [];
  for (const m of d.matchAll(/[MmLl]\s*([-\d.eE+]+)/g)) xs.push(+m[1]!);
  return xs;
}

function stemX(stem: Element, stop: Element): number | null {
  const p = stem.querySelector('path');
  const d = p?.getAttribute('d') || '';
  const m = /M\s*([-\d.eE+]+)/i.exec(d);
  let tx = 0;
  let cur: Element | null = stem;
  while (cur && cur !== stop.parentElement) {
    const tr = cur.getAttribute('transform') || '';
    const tm = /translate\(\s*([-\d.]+)/.exec(tr);
    if (tm) tx += +tm[1]!;
    if (cur === stop) break;
    cur = cur.parentElement;
  }
  // accumulate up to measure
  tx = 0;
  cur = stem;
  while (cur && cur !== stop) {
    const tr = cur.getAttribute('transform') || '';
    const tm = /translate\(\s*([-\d.]+)/.exec(tr);
    if (tm) tx += +tm[1]!;
    cur = cur.parentElement;
  }
  const trStop = stop.getAttribute('transform') || '';
  // don't include measure transform
  return m ? +m[1]! + tx : null;
}

async function main(): Promise<void> {
  if (!OSMD) throw new Error('no OSMD');
  const xml = await loadXml();
  const host = document.getElementById('host')!;
  const osmd = new OSMD!(host, { autoResize: false, drawTitle: false, alignRests: 0 });
  osmd.EngravingRules.SoftmaxFactorVexFlow = 100;
  osmd.EngravingRules.VoiceSpacingAddendVexflow = 3.5;
  registerOsmdPreviewXmlForAlign(osmd, xml);
  await osmd.load(xml);
  osmd.render();
  alignOsmdPreviewNotesByOnsetColumn(osmd, xml);
  alignOsmdPreviewNotesByOnsetColumn(osmd, xml);

  let checked = 0;
  const failures: string[] = [];
  forEachGraphicalMeasure(osmd, (gm) => {
    if (measureMxlFromGraphic(gm) !== 13) return;
    let el: Element | null = null;
    for (const se of (gm as any).staffEntries ?? []) {
      for (const gve of se.graphicalVoiceEntries ?? []) {
        for (const gn of gve.notes ?? []) {
          try {
            el = osmd.EngravingRules?.GNote?.(gn.sourceNote)?.getSVGGElement?.() ?? null;
          } catch {
            /* */
          }
          if (el) break;
        }
      }
    }
    const sn = el?.closest?.('.vf-stavenote') ?? el;
    const mg = sn?.closest?.('.vf-measure') as Element | null;
    if (!mg) return;
    const stems = [...mg.querySelectorAll('.vf-stem')];
    const stemXs = stems
      .map((s) => stemX(s, mg))
      .filter((x): x is number => x != null)
      .sort((a, b) => a - b);
    for (const beam of mg.querySelectorAll(':scope > .vf-beam, .vf-beam')) {
      const d = beam.querySelector('path')?.getAttribute('d') || '';
      const xs = pathXs(d);
      if (xs.length < 2) continue;
      const L = Math.min(...xs);
      const R = Math.max(...xs);
      const W = R - L;
      if (W < 12) continue; // true hooks only — 8분 beams often 14–17px
      let btx = 0;
      let cur: Element | null = beam;
      while (cur && cur !== mg) {
        const tr = cur.getAttribute('transform') || '';
        const tm = /translate\(\s*([-\d.]+)/.exec(tr);
        if (tm) btx += +tm[1]!;
        cur = cur.parentElement;
      }
      const left = L + btx;
      const right = R + btx;
      const nearL = stemXs.map((x) => ({ x, d: Math.abs(x - left) })).sort((a, b) => a.d - b.d)[0];
      const nearR = stemXs.map((x) => ({ x, d: Math.abs(x - right) })).sort((a, b) => a.d - b.d)[0];
      checked += 1;
      if (!nearL || nearL.d > 1.5) {
        failures.push(`beam W=${W.toFixed(1)} left tipGap=${nearL?.d}`);
      }
      if (!nearR || nearR.d > 1.5) {
        failures.push(`beam W=${W.toFixed(1)} right tipGap=${nearR?.d}`);
      }
    }
  });
  if (checked < 2) throw new Error(`expected primary beams, got ${checked}`);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log('OK m13 eighth beam tips', { checked });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
