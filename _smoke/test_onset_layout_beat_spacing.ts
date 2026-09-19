/**
 * m13 — SVG onset-layout align 후 성부별 박자 간격 CV·양 오선 동시 onset 정렬.
 * Run: npx tsx _smoke/test_onset_layout_beat_spacing.ts
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  stripMeasureWidthAttributesForOsmdPreview,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
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

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const r = asRec(v);
  if (!r) return null;
  if (typeof r.realValue === 'number') return r.realValue;
  if (typeof r.RealValue === 'number') return r.RealValue;
  return null;
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

function spacingCvFromXs(byOnset: Map<number, number>): number | null {
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

function collectVoiceOnsetXs(
  osmd: any,
  measureNumber: number,
  voiceId: string,
): Map<number, number> {
  const byOnset = new Map<number, number>();
  forEachGraphicalMeasure(osmd, (gm) => {
    const mn = measureMxlFromGraphic(gm);
    if (mn !== measureNumber) return;
    const staffEntries = (gm as any).staffEntries ?? (gm as any).StaffEntries ?? [];
    for (const se of staffEntries) {
      const ts = num(se.absoluteTimestamp ?? se.AbsoluteTimestamp ?? se.relInMeasureTimestamp);
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
            /* ignore */
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

async function loadPreviewXml(): Promise<string> {
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
  const xml = await loadPreviewXml();
  const host = document.getElementById('host')!;
  host.innerHTML = '';
  const osmd = new OSMD!(host, { autoResize: false, drawTitle: false, alignRests: 0 });
  if (typeof osmd.EngravingRules.SoftmaxFactorVexFlow === 'number') {
    osmd.EngravingRules.SoftmaxFactorVexFlow = Math.max(osmd.EngravingRules.SoftmaxFactorVexFlow, 100);
  }
  if (typeof osmd.EngravingRules.VoiceSpacingAddendVexflow === 'number') {
    osmd.EngravingRules.VoiceSpacingAddendVexflow = Math.max(
      osmd.EngravingRules.VoiceSpacingAddendVexflow,
      3.5,
    );
  }
  registerOsmdPreviewXmlForAlign(osmd, xml);
  await osmd.load(xml);
  osmd.render();

  const beforeV1 = spacingCvFromXs(collectVoiceOnsetXs(osmd, 13, '1'));
  alignOsmdPreviewNotesByOnsetColumn(osmd, xml);
  alignOsmdPreviewNotesByOnsetColumn(osmd, xml);
  const afterV1Map = collectVoiceOnsetXs(osmd, 13, '1');
  const afterV1 = spacingCvFromXs(afterV1Map);
  const afterV5 = spacingCvFromXs(collectVoiceOnsetXs(osmd, 13, '5'));

  console.log(
    'm13 spacingCV v1 before=',
    beforeV1?.toFixed(3),
    'after=',
    afterV1?.toFixed(3),
    'v5 after=',
    afterV5?.toFixed(3),
  );
  const sorted = [...afterV1Map.entries()].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    const dOn = sorted[i]![0] - sorted[i - 1]![0];
    const dX = sorted[i]![1] - sorted[i - 1]![1];
    console.log(
      `  v1 onset ${sorted[i - 1]![0].toFixed(3)}→${sorted[i]![0].toFixed(3)} Δ=${dOn.toFixed(3)} Δx=${dX.toFixed(1)} rate=${(dX / dOn).toFixed(1)}`,
    );
  }

  const v1 = collectVoiceOnsetXs(osmd, 13, '1');
  const v5 = collectVoiceOnsetXs(osmd, 13, '5');
  for (const [ts, x5] of v5) {
    let best: number | null = null;
    let bestD = Infinity;
    for (const [t1, x1] of v1) {
      const d = Math.abs(t1 - ts);
      if (d < bestD) {
        bestD = d;
        best = x1;
      }
    }
    if (best != null && bestD < 0.02) {
      const gap = Math.abs(best - x5);
      console.log(`  shared onset~${ts.toFixed(3)} |v1-v5|=${gap.toFixed(1)}`);
      if (gap > 20) throw new Error(`cross-staff onset misaligned by ${gap}px at ${ts}`);
    }
  }

  if (afterV1 == null) throw new Error('no after CV');
  // 박자 간격은 Softmax(≥100)에 맡김 — SVG 전곡 재배치로 CV를 0으로 만들지 않음(오선·빔 보존).
  if (afterV1 > 0.55) {
    throw new Error(`m13 v1 Softmax beat spacing CV too high: ${afterV1}`);
  }
  if (afterV5 != null && afterV5 > 0.45) {
    throw new Error(`m13 v5 Softmax beat spacing CV too high: ${afterV5}`);
  }
  console.log('OK onset layout beat spacing (Softmax)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
