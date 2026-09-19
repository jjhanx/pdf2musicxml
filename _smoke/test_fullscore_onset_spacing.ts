/**
 * Full-score m13: every part with ≥3 timed notes should have low spacing CV after align,
 * and no note left of contentLeft (beginInstructions).
 * Run: npx tsx _smoke/test_fullscore_onset_spacing.ts
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
import {
  forEachGraphicalMeasure,
  getOsmdUnitInPixels,
  measureMxlFromGraphic,
  partIdFromGraphic,
} from '../src/osmdMeasureClick';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:2400px;height:3600px"></div></body></html>',
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

async function main(): Promise<void> {
  if (!OSMD) throw new Error('no OSMD');
  const buf = fs.readFileSync('omr-work-6895627c.zip');
  const z = await JSZip.loadAsync(buf);
  const mxl = await z.file('review.mxl')!.async('nodebuffer');
  const inner = await JSZip.loadAsync(mxl);
  const name = Object.keys(inner.files).find((n) => n.endsWith('.xml') && !n.toUpperCase().includes('META'))!;
  let xml = await inner.file(name)!.async('string');
  xml = repairTimelineForOsmdPreview(xml, { faithfulEditorLayout: true });
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = stripMeasureWidthAttributesForOsmdPreview(xml);
  xml = stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml);

  // Keep measures 12–14 only (faster) but all parts
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    for (const m of [...part.children]) {
      const tag = ((m as Element).localName || (m as Element).tagName).toLowerCase();
      if (tag !== 'measure') continue;
      const n = parseInt((m as Element).getAttribute('number') || '0', 10);
      if (n < 12 || n > 14) m.remove();
    }
  }
  xml = '<?xml version="1.0"?>' + new XMLSerializer().serializeToString(doc);

  const host = document.getElementById('host')!;
  const osmd = new OSMD!(host, { autoResize: false, drawTitle: false, alignRests: 0 });
  if (typeof osmd.EngravingRules.SoftmaxFactorVexFlow === 'number') {
    osmd.EngravingRules.SoftmaxFactorVexFlow = Math.max(osmd.EngravingRules.SoftmaxFactorVexFlow, 100);
  }
  registerOsmdPreviewXmlForAlign(osmd, xml);
  await osmd.load(xml);
  osmd.zoom = 0.45;
  osmd.render();
  alignOsmdPreviewNotesByOnsetColumn(osmd, xml);
  alignOsmdPreviewNotesByOnsetColumn(osmd, xml);

  const scale = getOsmdUnitInPixels(osmd);
  const failures: string[] = [];
  const report: string[] = [];

  forEachGraphicalMeasure(osmd, (gm) => {
    if (measureMxlFromGraphic(gm) !== 13) return;
    const pid = partIdFromGraphic(gm) ?? '?';
    const bi = (gm as any).beginInstructionsWidth ?? 0;
    const pos = (gm as any).PositionAndShape ?? (gm as any).positionAndShape;
    const abs = pos?.AbsolutePosition ?? pos?.absolutePosition;
    const contentLeft = abs?.x != null ? (abs.x + bi) * scale : null;

    const byVoice = new Map<string, Map<number, number>>();
    const seen = new Set<SVGGraphicsElement>();
    for (const se of (gm as any).staffEntries ?? []) {
      const ts = num(se.absoluteTimestamp ?? se.AbsoluteTimestamp ?? se.relInMeasureTimestamp);
      if (ts == null) continue;
      for (const gve of se.graphicalVoiceEntries ?? []) {
        for (const gn of gve.notes ?? []) {
          const src = gn.sourceNote ?? gn.SourceNote;
          const pve = src?.ParentVoiceEntry ?? src?.parentVoiceEntry;
          const pv = pve?.ParentVoice ?? pve?.parentVoice;
          const vid = String(pv?.VoiceId ?? pv?.voiceId ?? '?');
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
          if (x == null) continue;
          if (contentLeft != null && x + 0.5 < contentLeft) {
            failures.push(`${pid} v${vid} note x=${x.toFixed(1)} < contentLeft=${contentLeft.toFixed(1)}`);
          }
          const map = byVoice.get(vid) ?? new Map<number, number>();
          const prev = map.get(ts);
          if (prev == null || x < prev) map.set(ts, x);
          byVoice.set(vid, map);
        }
      }
    }

    for (const [vid, map] of byVoice) {
      const cv = spacingCv(map);
      if (cv == null) continue;
      report.push(`${pid} v${vid} onsets=${map.size} cv=${cv.toFixed(3)}`);
      if (cv > 0.25) failures.push(`${pid} v${vid} spacing CV ${cv.toFixed(3)} > 0.25`);
    }
  });

  console.log(report.join('\n'));
  if (failures.length) {
    console.error('FAIL\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log('OK fullscore onset spacing m13');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
