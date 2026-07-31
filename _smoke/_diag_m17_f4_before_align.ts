/**
 * F4 v2 natural OSMD x + timestamp BEFORE SVG align — detect inverted order.
 * Run: npx tsx _smoke/_diag_m17_f4_before_align.ts
 */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
import { registerOsmdPreviewXmlForAlign, alignOsmdPreviewNotesByOnsetColumn } from '../src/osmdOnsetColumnAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from '../src/osmdMeasureClick';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildFullPreview(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  for (const part of [...doc.querySelectorAll('part,*|part')]) {
    if (part.getAttribute('id') !== 'P5') part.remove();
  }
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (local(child) === 'note') {
        const st = child.querySelector('staff,*|staff')?.textContent?.trim();
        if (st && st !== '1') child.remove();
      }
    }
    measure.querySelectorAll('note staff,note *|staff').forEach((el) => {
      el.textContent = '1';
    });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  xml = new XMLSerializer().serializeToString(doc);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = repairMissingNoteTypesForOsmdPreview(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  return stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml);
}

type F4Hit = { x: number; ts: number; heads: number; phase: string };

function collectF4v2(osmd: unknown, phase: string): F4Hit[] {
  const out: F4Hit[] = [];
  const seen = new Set<SVGGraphicsElement>();
  forEachGraphicalMeasure(osmd as never, (gm) => {
    if (measureMxlFromGraphic(gm) !== 17) return;
    const gmR = gm as Record<string, unknown>;
    for (const se of (gmR.staffEntries ?? gmR.StaffEntries ?? []) as unknown[]) {
      const seR = se as Record<string, unknown>;
      for (const gve of (seR.graphicalVoiceEntries ?? seR.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gveR = gve as Record<string, unknown>;
        const pve = (gveR.parentVoiceEntry ?? gveR.ParentVoiceEntry) as Record<string, unknown> | undefined;
        const tsRaw = pve?.Timestamp ?? pve?.timestamp;
        const ts =
          typeof tsRaw === 'number'
            ? tsRaw
            : typeof (tsRaw as Record<string, unknown>)?.realValue === 'number'
              ? ((tsRaw as Record<string, unknown>).realValue as number)
              : 0;
        for (const gn of (gveR.notes ?? gveR.Notes ?? []) as unknown[]) {
          const gnR = gn as Record<string, unknown>;
          const vfp = gnR.vfpitch ?? gnR.vfPitch;
          const p = Array.isArray(vfp) ? vfp[0] : vfp;
          if (typeof p !== 'string' || !/^f4/i.test(p)) continue;
          const src = (gnR.sourceNote ?? gnR.SourceNote) as Record<string, unknown>;
          const pve2 = (src?.ParentVoiceEntry ?? src?.parentVoiceEntry) as Record<string, unknown>;
          const pv = (pve2?.ParentVoice ?? pve2?.parentVoice) as Record<string, unknown>;
          const vid = pv?.VoiceId ?? pv?.voiceId;
          if (vid !== 2 && vid !== '2') continue;
          const rules = (osmd as { EngravingRules?: { GNote?: (n: unknown) => unknown } }).EngravingRules;
          let sn: SVGGraphicsElement | null = null;
          try {
            const gnote = rules?.GNote?.(src);
            sn =
              ((gnote as { getSVGGElement?: () => SVGGraphicsElement })?.getSVGGElement?.()?.closest?.(
                '.vf-stavenote,.vf-staveNote',
              ) as SVGGraphicsElement | null) ?? null;
          } catch {
            /* ignore */
          }
          if (!sn || seen.has(sn)) continue;
          seen.add(sn);
          const path = sn.querySelector('.vf-notehead path');
          const d = path?.getAttribute('d');
          const m = d && /^M\s*([-\d.]+)/.exec(d.trim());
          const ctm = (path as SVGGraphicsElement | null)?.getCTM?.() ?? sn.getCTM?.();
          if (!m || !ctm) continue;
          const x = ctm.a * parseFloat(m[1]!) + ctm.e;
          out.push({ x, ts, heads: sn.querySelectorAll('.vf-notehead').length, phase });
        }
      }
    }
  });
  return out;
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_play_order_234.py', {
    encoding: 'utf8',
    maxBuffer: 30e6,
  });
  const xml = buildFullPreview(raw);
  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, xml);
  await (osmd as { load: (x: string) => Promise<void> }).load(xml);
  (osmd as { render: () => void }).render();

  const before = collectF4v2(osmd, 'before');
  console.log('BEFORE align:', before);
  if (before.length >= 2) {
    const byX = [...before].sort((a, b) => a.x - b.x);
    const byTs = [...before].sort((a, b) => a.ts - b.ts);
    console.log('byX heads:', byX.map((h) => h.heads));
    console.log('byTs heads:', byTs.map((h) => h.heads));
    if (byX[0]!.heads >= 4 && byX[1]!.heads === 2) {
      console.log('WARN: po4 (4-head) is LEFT of po2 (2-head) — x-sort matching will swap!');
    }
    if (byTs[0]!.heads === 2 && byTs[1]!.heads >= 4) {
      console.log('OK: ts-order matches po2 before po4');
    }
  }

  alignOsmdPreviewNotesByOnsetColumn(osmd as never, xml);
  const after = collectF4v2(osmd, 'after');
  console.log('AFTER align:', after);

  const e5x = (() => {
    let x: number | null = null;
    forEachGraphicalMeasure(osmd as never, (gm) => {
      if (measureMxlFromGraphic(gm) !== 17 || x != null) return;
      const gmR = gm as Record<string, unknown>;
      for (const se of (gmR.staffEntries ?? gmR.StaffEntries ?? []) as unknown[]) {
        for (const gve of ((se as Record<string, unknown>).graphicalVoiceEntries ??
          (se as Record<string, unknown>).GraphicalVoiceEntries ??
          []) as unknown[]) {
          for (const gn of ((gve as Record<string, unknown>).notes ??
            (gve as Record<string, unknown>).Notes ??
            []) as unknown[]) {
            const gnR = gn as Record<string, unknown>;
            const vfp = gnR.vfpitch ?? gnR.vfPitch;
            const p = Array.isArray(vfp) ? vfp[0] : vfp;
            if (p !== 'e5n/5') continue;
            const src = gnR.sourceNote ?? gnR.SourceNote;
            const rules = (osmd as { EngravingRules?: { GNote?: (n: unknown) => unknown } }).EngravingRules;
            const gnote = rules?.GNote?.(src);
            const sn = (gnote as { getSVGGElement?: () => SVGGraphicsElement })?.getSVGGElement?.();
            const path = sn?.querySelector('.vf-notehead path');
            const d = path?.getAttribute('d');
            const m = d && /^M\s*([-\d.]+)/.exec(d.trim());
            const ctm = path?.getCTM?.();
            if (m && ctm) x = ctm.a * parseFloat(m[1]!) + ctm.e;
          }
        }
      }
    });
    return x;
  })();
  const f5x = (() => {
    let x: number | null = null;
    forEachGraphicalMeasure(osmd as never, (gm) => {
      if (measureMxlFromGraphic(gm) !== 17 || x != null) return;
      const gmR = gm as Record<string, unknown>;
      for (const se of (gmR.staffEntries ?? gmR.StaffEntries ?? []) as unknown[]) {
        for (const gve of ((se as Record<string, unknown>).graphicalVoiceEntries ??
          (se as Record<string, unknown>).GraphicalVoiceEntries ??
          []) as unknown[]) {
          for (const gn of ((gve as Record<string, unknown>).notes ??
            (gve as Record<string, unknown>).Notes ??
            []) as unknown[]) {
            const gnR = gn as Record<string, unknown>;
            const vfp = gnR.vfpitch ?? gnR.vfPitch;
            const p = Array.isArray(vfp) ? vfp[0] : vfp;
            if (p !== 'f5n/5') continue;
            const src = gnR.sourceNote ?? gnR.SourceNote;
            const rules = (osmd as { EngravingRules?: { GNote?: (n: unknown) => unknown } }).EngravingRules;
            const gnote = rules?.GNote?.(src);
            const sn = (gnote as { getSVGGElement?: () => SVGGraphicsElement })?.getSVGGElement?.();
            const path = sn?.querySelector('.vf-notehead path');
            const d = path?.getAttribute('d');
            const m = d && /^M\s*([-\d.]+)/.exec(d.trim());
            const ctm = path?.getCTM?.();
            if (m && ctm) x = ctm.a * parseFloat(m[1]!) + ctm.e;
          }
        }
      }
    });
    return x;
  })();

  const f4Po2 = after.find((h) => h.heads === 2);
  console.log('e5x', e5x, 'f5x', f5x, 'f4Po2', f4Po2);
  if (f4Po2 && e5x != null && f5x != null) {
    console.log('po2 gap to E5', Math.abs(f4Po2.x - e5x), 'f4Po2 < f5', f4Po2.x < f5x - 5);
  }
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
