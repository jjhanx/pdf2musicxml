/**
 * Regression: 4637986c m17 with correct play orders — after SVG align,
 * [F4,Bb4](po2) sits with E5, left of F5(po3).
 *
 * Run: npx tsx _smoke/test_4637986c_m17_po2_align.ts
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
import { applyPlayOrderLayoutToMeasure } from '../shared/musicXmlPlayOrder';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
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
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
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
    if (ctm) {
      xs.push(ctm.a * parseFloat(m[1]!) + ctm.e);
      continue;
    }
    let tx = 0;
    let cur: Element | null = pathEl;
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

function pitchFromVf(vfpitch: unknown): string | null {
  const raw = Array.isArray(vfpitch) ? vfpitch[0] : vfpitch;
  if (typeof raw !== 'string') return null;
  const m = /^([a-g])(b?)n\/(\d+)$/i.exec(raw.trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()}${m[2] === 'b' ? 'b' : ''}${m[3]}`;
}

function buildPrPreview(raw: string): string {
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
    applyPlayOrderLayoutToMeasure(measure);
  }
  for (const sp of [...doc.querySelectorAll('score-part,*|score-part')]) {
    if (sp.getAttribute('id') !== 'P5') sp.remove();
  }
  return repairTimelineForOsmdPreview(new XMLSerializer().serializeToString(doc));
}

function sanitize(xml: string): string {
  let out = repairRestDisplayForOsmdPreview(xml);
  out = repairMissingNoteTypesForOsmdPreview(out);
  out = repairTimelineForOsmdPreview(out);
  out = repairUnderfullMeasuresForOsmdPreview(out);
  return stripDefaultXyKeepLayoutAttrsForOsmdPreview(out);
}

type Hit = { pitch: string; x: number; heads: number };

function collectM17Hits(osmd: unknown): Hit[] {
  const hits: Hit[] = [];
  const seen = new Set<SVGGraphicsElement>();
  forEachGraphicalMeasure(osmd as never, (gmRaw) => {
    if (measureMxlFromGraphic(gmRaw) !== 17) return;
    const gm = asRecord(gmRaw);
    if (!gm) return;
    for (const seRaw of (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[]) {
      const se = asRecord(seRaw);
      if (!se) continue;
      for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          if (!gn) continue;
          const pitch = pitchFromVf(gn.vfpitch ?? gn.vfPitch);
          if (!pitch) continue;
          const src = asRecord(gn.sourceNote ?? gn.SourceNote);
          const rules = asRecord(asRecord(osmd)?.EngravingRules);
          let stavenote: SVGGraphicsElement | null = null;
          try {
            const gnote = (rules?.GNote as ((n: unknown) => unknown) | undefined)?.(src);
            const svgEl = (asRecord(gnote) as { getSVGGElement?: () => SVGGraphicsElement | null } | null)
              ?.getSVGGElement?.();
            if (svgEl) {
              stavenote =
                (svgEl.closest?.('.vf-stavenote, .vf-staveNote') as SVGGraphicsElement | null) ?? svgEl;
            }
          } catch {
            /* ignore */
          }
          if (!stavenote || seen.has(stavenote)) continue;
          seen.add(stavenote);
          const x = noteheadX(stavenote);
          if (x == null) continue;
          hits.push({ pitch, x, heads: stavenote.querySelectorAll('.vf-notehead').length });
        }
      }
    }
  });
  return hits;
}

async function main() {
  if (!fs.existsSync('omr-work-4637986c.zip')) {
    console.log('skip');
    return;
  }
  execSync('python _smoke/_export_463_po.py', { stdio: 'inherit' });
  const raw = fs.readFileSync('_smoke/_tmp_463_po_fixed.xml', 'utf8');
  const forOsmd = sanitize(buildPrPreview(raw));

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, forOsmd);
  await (osmd as { load: (x: string) => Promise<void> }).load(forOsmd);
  (osmd as { render: () => void }).render();
  // two passes — over-cap clamp then converge (browser autoResize와 동일)
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);

  const hits = collectM17Hits(osmd);
  const e5 = hits.find((h) => h.pitch === 'E5');
  const f5 = hits.find((h) => h.pitch === 'F5' && h.heads <= 2);
  const f4Po2 = hits.filter((h) => h.pitch === 'F4' && h.heads === 2).sort((a, b) => a.x - b.x)[0];
  const f4Po4 = hits.filter((h) => h.pitch === 'F4' && h.heads >= 4).sort((a, b) => a.x - b.x)[0];
  if (!e5 || !f5 || !f4Po2 || !f4Po4) {
    throw new Error(`missing ${JSON.stringify({ e5, f5, f4Po2, f4Po4, hits })}`);
  }
  const po2Gap = Math.abs(f4Po2.x - e5.x);
  if (po2Gap > 14) {
    throw new Error(`[F4,Bb4] must align with E5 gap=${po2Gap} f4=${f4Po2.x} e5=${e5.x}`);
  }
  if (f4Po2.x >= f5.x - 5) {
    throw new Error(`[F4,Bb4] must be left of F5: f4=${f4Po2.x} f5=${f5.x}`);
  }
  console.log('OK 4637986c m17 po2 align', {
    e5: e5.x,
    f4Po2: f4Po2.x,
    f5: f5.x,
    f4Po4: f4Po4.x,
    po2Gap,
  });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
