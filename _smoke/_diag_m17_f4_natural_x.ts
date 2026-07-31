/**
 * Natural OSMD x for duplicate F4 v2 before SVG align — queue order check.
 * Run: npx tsx _smoke/_diag_m17_f4_natural_x.ts
 */
import fs from 'node:fs';
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
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
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
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildPreview(raw: string): string {
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
  xml = repairMissingNoteTypesForOsmdPreview(xml);
  return stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml);
}

function noteheadX(sn: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of sn.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const pathEl = path as SVGGraphicsElement;
    const ctm = pathEl.getCTM?.() ?? sn.getCTM?.();
    if (ctm) xs.push(ctm.a * parseFloat(m[1]!) + ctm.e);
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_play_order_234.py', {
    encoding: 'utf8',
    maxBuffer: 30e6,
  });
  const xml = buildPreview(raw);
  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { backend: 'svg', drawMeasureNumbers: false });
  await (osmd as { load: (x: string) => Promise<void> }).load(xml);
  (osmd as { render: () => void }).render();

  const f4v2: Array<{ x: number; heads: number; order: number }> = [];
  forEachGraphicalMeasure(osmd as never, (gm) => {
    if (measureMxlFromGraphic(gm) !== 17) return;
    const gmR = gm as Record<string, unknown>;
    for (const se of (gmR.staffEntries ?? gmR.StaffEntries ?? []) as unknown[]) {
      const seR = se as Record<string, unknown>;
      for (const gve of (seR.graphicalVoiceEntries ?? seR.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gveR = gve as Record<string, unknown>;
        for (const gn of (gveR.notes ?? gveR.Notes ?? []) as unknown[]) {
          const gnR = gn as Record<string, unknown>;
          const vfp = gnR.vfpitch ?? gnR.vfPitch;
          const raw = Array.isArray(vfp) ? vfp[0] : vfp;
          if (typeof raw !== 'string' || !/^f4/i.test(raw)) continue;
          const src = gnR.sourceNote ?? gnR.SourceNote;
          const pve = (src as Record<string, unknown>)?.ParentVoiceEntry ?? (src as Record<string, unknown>)?.parentVoiceEntry;
          const pv = (pve as Record<string, unknown>)?.ParentVoice ?? (pve as Record<string, unknown>)?.parentVoice;
          const vid = (pv as Record<string, unknown>)?.VoiceId ?? (pv as Record<string, unknown>)?.voiceId;
          if (vid !== 2 && vid !== '2') continue;
          const rules = (osmd as { EngravingRules?: { GNote?: (n: unknown) => unknown } }).EngravingRules;
          const gnote = rules?.GNote?.(src);
          const svgEl = (gnote as { getSVGGElement?: () => SVGGraphicsElement })?.getSVGGElement?.();
          const sn = (svgEl?.closest?.('.vf-stavenote,.vf-staveNote') ?? svgEl) as SVGGraphicsElement | null;
          if (!sn) continue;
          const x = noteheadX(sn);
          if (x == null) continue;
          f4v2.push({ x, heads: sn.querySelectorAll('.vf-notehead').length, order: f4v2.length });
        }
      }
    }
  });
  console.log('F4 v2 natural OSMD traversal order:', f4v2);
  if (f4v2.length >= 2 && f4v2[0]!.x > f4v2[1]!.x) {
    console.log('WARN: po4 F4 appears before po2 F4 in OSMD traversal — FIFO queue swap');
  }
}

main();
