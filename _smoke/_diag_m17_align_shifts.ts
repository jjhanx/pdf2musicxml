/**
 * Before/after SVG align — shifts, skipped >120px, F4 v2 po2 vs po3.
 * Run: npx tsx _smoke/_diag_m17_align_shifts.ts
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
  collectLinkedParallelOnsetHintsFromXml,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
import { collectPreviewNoteLayoutTargetsFromXml } from '../shared/musicXmlPlayOrder';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
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

function pitchFromVf(vfpitch: unknown): string | null {
  const raw = Array.isArray(vfpitch) ? vfpitch[0] : vfpitch;
  if (typeof raw !== 'string') return null;
  const m = /^([a-g])(b?)n\/(\d+)$/i.exec(raw.trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()}${m[2] === 'b' ? 'b' : ''}${m[3]}`;
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

type M17Hit = { pitch: string; voice: string; x: number; heads: number };

function collectM17(osmd: unknown): M17Hit[] {
  const hits: M17Hit[] = [];
  const seen = new Set<SVGGraphicsElement>();
  forEachGraphicalMeasure(osmd as never, (gmRaw) => {
    if (measureMxlFromGraphic(gmRaw) !== 17) return;
    const gm = gmRaw as Record<string, unknown>;
    for (const seRaw of (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[]) {
      const se = seRaw as Record<string, unknown>;
      for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gve = gveRaw as Record<string, unknown>;
        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
          const gn = gnRaw as Record<string, unknown>;
          const pitch = pitchFromVf(gn.vfpitch ?? gn.vfPitch);
          if (!pitch) continue;
          const src = gn.sourceNote ?? gn.SourceNote;
          const pve = (src as Record<string, unknown>)?.ParentVoiceEntry ?? (src as Record<string, unknown>)?.parentVoiceEntry;
          const pv = (pve as Record<string, unknown>)?.ParentVoice ?? (pve as Record<string, unknown>)?.parentVoice;
          const vid = (pv as Record<string, unknown>)?.VoiceId ?? (pv as Record<string, unknown>)?.voiceId;
          const voice = vid != null ? String(vid) : '?';
          const rules = (osmd as { EngravingRules?: { GNote?: (n: unknown) => unknown } }).EngravingRules;
          let sn: SVGGraphicsElement | null = null;
          try {
            const gnote = rules?.GNote?.(src);
            sn = (gnote as { getSVGGElement?: () => SVGGraphicsElement })?.getSVGGElement?.() ?? null;
            if (sn) sn = (sn.closest?.('.vf-stavenote,.vf-staveNote') as SVGGraphicsElement) ?? sn;
          } catch {
            /* ignore */
          }
          if (!sn || seen.has(sn)) continue;
          seen.add(sn);
          const x = noteheadX(sn);
          if (x == null) continue;
          hits.push({ pitch, voice, x, heads: sn.querySelectorAll('.vf-notehead').length });
        }
      }
    }
  });
  return hits;
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_play_order_234.py', {
    encoding: 'utf8',
    maxBuffer: 30e6,
  });
  const xml = buildPreview(raw);
  const targets = collectPreviewNoteLayoutTargetsFromXml(xml).filter((t) => t.measureNumber === 17);
  console.log(
    'F4 v2 targets',
    targets.filter((t) => t.pitch === 'F4' && t.voice === '2').map((t) => t.defaultXTenths),
  );
  console.log(
    'hints m17',
    collectLinkedParallelOnsetHintsFromXml(xml).filter((h) => h.measureNumber === 17),
  );

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, xml);
  await (osmd as { load: (x: string) => Promise<void> }).load(xml);
  (osmd as { render: () => void }).render();

  const before = collectM17(osmd);
  console.log('BEFORE align', before);

  alignOsmdPreviewNotesByOnsetColumn(osmd as never, xml);
  const after = collectM17(osmd);
  console.log('AFTER align', after);

  const e5 = after.find((h) => h.pitch === 'E5');
  const f5 = after.find((h) => h.pitch === 'F5' && h.heads <= 2);
  const f4Po2 = after.filter((h) => h.pitch === 'F4' && h.heads === 2).sort((a, b) => a.x - b.x)[0];
  if (e5 && f4Po2 && f5) {
    console.log('po2 gap', Math.abs(f4Po2.x - e5.x), 'f4Po2<f5', f4Po2.x < f5.x - 5);
  }
}

main();
