/**
 * Remesh must re-run when zoom changes; AbsolutePosition→px must include zoom
 * so last notes stay inside the measure at default 60% zoom.
 * Run: npx tsx _smoke/test_zoom_remesh_trailing.ts
 */
import assert from 'node:assert/strict';
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
  '<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:900px"></div></body></html>',
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

function collectVoiceOnsetXs(osmd: any, measureNumber: number, voiceId: string): Map<number, number> {
  const byOnset = new Map<number, number>();
  forEachGraphicalMeasure(osmd, (gm) => {
    if (measureMxlFromGraphic(gm) !== measureNumber) return;
    for (const se of (gm as any).staffEntries ?? (gm as any).StaffEntries ?? []) {
      const tsRaw =
        se.absoluteTimestamp ?? se.AbsoluteTimestamp ?? se.relInMeasureTimestamp;
      const ts =
        typeof tsRaw?.realValue === 'number'
          ? tsRaw.realValue
          : typeof tsRaw?.RealValue === 'number'
            ? tsRaw.RealValue
            : typeof tsRaw === 'number'
              ? tsRaw
              : null;
      if (ts == null) continue;
      for (const gve of se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) {
        for (const gn of gve.notes ?? gve.Notes ?? []) {
          const src = gn.sourceNote ?? gn.SourceNote;
          const pve = src?.ParentVoiceEntry ?? src?.parentVoiceEntry;
          const pv = pve?.ParentVoice ?? pve?.parentVoice;
          const vid = String(pv?.VoiceId ?? pv?.voiceId ?? '?');
          if (vid !== voiceId) continue;
          let el: SVGGraphicsElement | null = null;
          try {
            el = osmd.EngravingRules?.GNote?.(src)?.getSVGGElement?.() ?? null;
          } catch {
            /* */
          }
          if (!el) continue;
          const sn =
            (el.classList?.contains?.('vf-stavenote')
              ? el
              : (el.closest?.('.vf-stavenote, .vf-staveNote') as SVGGraphicsElement | null)) ?? null;
          if (!sn) continue;
          const x = noteheadCenterX(sn);
          if (x == null) continue;
          const prev = byOnset.get(ts);
          if (prev == null || x < prev) byOnset.set(ts, x);
        }
      }
    }
  });
  return byOnset;
}

function spacingCv(byOnset: Map<number, number>): number | null {
  const sorted = [...byOnset.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length < 3) return null;
  const rates: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dOn = sorted[i]![0] - sorted[i - 1]![0];
    const dX = sorted[i]![1] - sorted[i - 1]![1];
    if (dOn > 1e-6 && Math.abs(dX) > 0.01) rates.push(dX / dOn);
  }
  if (rates.length < 2) return null;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (Math.abs(mean) < 1e-9) return null;
  const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

async function loadXml(): Promise<string> {
  const buf = fs.readFileSync('omr-work-6895627c.zip');
  const z = await JSZip.loadAsync(buf);
  const mxl = await z.file('review.mxl')!.async('nodebuffer');
  const inner = await JSZip.loadAsync(mxl);
  const name = Object.keys(inner.files).find((n) => n.endsWith('.xml') && !n.toUpperCase().includes('META'))!;
  let xml = await inner.file(name)!.async('string');
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = applyPlayOrderLayoutToXml(xml);
  xml = stripMeasureWidthAttributesForOsmdPreview(xml);
  xml = stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    if (part.getAttribute('id') !== 'P5') part.remove();
  }
  for (const sp of [...doc.querySelectorAll('score-part, *|score-part')]) {
    if (sp.getAttribute('id') !== 'P5') sp.remove();
  }
  const part = doc.querySelector('part, *|part')!;
  for (const m of [...part.children]) {
    const tag = ((m as Element).localName || (m as Element).tagName).toLowerCase();
    if (tag !== 'measure') continue;
    const n = parseInt((m as Element).getAttribute('number') || '0', 10);
    if (n < 12 || n > 14) m.remove();
  }
  return '<?xml version="1.0"?>' + new XMLSerializer().serializeToString(doc);
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

  for (const zoom of [0.6, 1.0]) {
    osmd.zoom = zoom;
    osmd.render();
    alignOsmdPreviewNotesByOnsetColumn(osmd, xml);
    alignOsmdPreviewNotesByOnsetColumn(osmd, xml);
    const map = collectVoiceOnsetXs(osmd, 13, '1');
    const cv = spacingCv(map);
    const sorted = [...map.entries()].sort((a, b) => a[0] - b[0]);
    const xs = sorted.map(([, x]) => x);
    const span = xs.length >= 2 ? xs[xs.length - 1]! - xs[0]! : 0;
    // Softmax-only at wrong zoom left last note near Softmax max; remesh should keep CV low
    console.log(`zoom=${zoom} CV=${cv?.toFixed(3)} span=${span.toFixed(1)}`);
    assert.ok(cv != null && cv < 0.28, `zoom ${zoom} CV too high: ${cv}`);
    // last interval proportional
    if (sorted.length >= 3) {
      const rates: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const dOn = sorted[i]![0] - sorted[i - 1]![0];
        const dX = sorted[i]![1] - sorted[i - 1]![1];
        if (dOn > 1e-6) rates.push(dX / dOn);
      }
      const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
      const last = rates[rates.length - 1]!;
      assert.ok(Math.abs(last - mean) / Math.abs(mean) < 0.08, `zoom ${zoom} last rate drift`);
    }
  }
  console.log('test_zoom_remesh_trailing: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
