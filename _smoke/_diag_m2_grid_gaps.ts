/**
 * Dump m2 layout-x per PO after slot grid + after SVG align.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
import { HITL_PLAY_ORDER_ATTR, applyPlayOrderLayoutToMeasure, buildPlayOrderSlotOnsets, effectivePlayOrder, defaultPlayOrdersFromTimeline } from '../shared/musicXmlPlayOrder';
import { previewLayoutLengthUnits } from '../shared/musicXmlPreviewOnsetLayout';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from '../src/osmdMeasureClick';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:900px"></div></body></html>');
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

function buildPr(raw: string, setM2Po: boolean): string {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  for (const part of [...doc.querySelectorAll('part')]) {
    if (part.getAttribute('id') !== 'P5') part.remove();
  }
  const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (local(child) === 'note') {
        const st = child.querySelector('staff')?.textContent?.trim();
        if (st && st !== '1') child.remove();
      }
    }
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    if (setM2Po && measure.getAttribute('number') === '2') {
      const leaders = [...measure.children].filter(
        (c) => local(c) === 'note' && !c.querySelector('chord'),
      );
      const qs = leaders.filter((n) => (n.querySelector('duration')?.textContent ?? '') === '2');
      qs.forEach((n, i) => {
        const po = String(i + 1);
        let cur: Element | null = n;
        while (cur && local(cur) === 'note') {
          cur.setAttribute(HITL_PLAY_ORDER_ATTR, po);
          const next = cur.nextElementSibling;
          if (!next || local(next) !== 'note' || !next.querySelector('chord')) break;
          cur = next;
        }
      });
      applyPlayOrderLayoutToMeasure(measure);
      const layoutLen = previewLayoutLengthUnits(measure);
      const defaults = defaultPlayOrdersFromTimeline(measure, 1);
      const leaders1 = leaders;
      const slots = buildPlayOrderSlotOnsets(leaders1, defaults, measure);
      console.log('m2 layoutLen', layoutLen, 'slots', Object.fromEntries(slots));
      for (const l of leaders1) {
        const step = l.querySelector('step')?.textContent ?? '';
        const oct = l.querySelector('octave')?.textContent ?? '';
        const po = l.getAttribute(HITL_PLAY_ORDER_ATTR);
        const lx = l.getAttribute('data-osmd-layout-x');
        const dur = l.querySelector('duration')?.textContent;
        console.log(`  ${step}${oct} po=${po} dur=${dur} lx=${lx}`);
      }
    } else {
      realignMeasureDefaultXFromTimelineForOsmd(measure);
    }
  }
  for (const sp of [...doc.querySelectorAll('score-part')]) {
    if (sp.getAttribute('id') !== 'P5') sp.remove();
  }
  xml = new XMLSerializer().serializeToString(doc);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = repairMissingNoteTypesForOsmdPreview(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  return stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml);
}

function pitchFromVf(vfpitch: unknown): string | null {
  const raw = Array.isArray(vfpitch) ? vfpitch[0] : vfpitch;
  if (typeof raw !== 'string') return null;
  const m = /^([a-g])(b?)n\/(\d+)$/i.exec(raw.trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()}${m[2] === 'b' ? 'b' : ''}${m[3]}`;
}

function columnX(sn: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of sn.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    const m = d && /^M\s*([-\d.]+)/.exec(d.trim());
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
  if (!xs.length) return null;
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const spread = Math.max(...xs) - Math.min(...xs);
  if (spread < 8) return avg;
  const stemRoot = sn.querySelector('.vf-stem');
  if (stemRoot) {
    for (const path of stemRoot.querySelectorAll('path')) {
      const d = path.getAttribute('d');
      const m = d && /^M\s*([-\d.]+)/.exec(d.trim());
      if (m) {
        let tx = 0;
        let cur: Element | null = path;
        while (cur) {
          const tr = cur.getAttribute?.('transform') ?? '';
          const tm = /translate\(\s*([-\d.]+)/.exec(tr);
          if (tm) tx += parseFloat(tm[1]!);
          cur = cur.parentElement;
        }
        const stem = tx + parseFloat(m[1]!);
        if (stem >= Math.min(...xs) - 2 && stem <= Math.max(...xs) + 2) return stem;
      }
    }
  }
  return avg;
}

async function main() {
  execSync(
    'python -c "import io,zipfile; from pathlib import Path; z=zipfile.ZipFile(\'omr-work-4637986c.zip\'); d=z.read(\'review.mxl\'); i=zipfile.ZipFile(io.BytesIO(d)); xml=i.read([n for n in i.namelist() if n.endswith(\'.xml\') and \'META\' not in n.upper()][0]); Path(\'_smoke/_tmp_463_raw.xml\').write_bytes(xml)"',
    { stdio: 'inherit' },
  );
  const raw = fs.readFileSync('_smoke/_tmp_463_raw.xml', 'utf8');
  const forOsmd = buildPr(raw, true);
  const host = document.getElementById('host')!;
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, forOsmd);
  await (osmd as { load: (x: string) => Promise<void> }).load(forOsmd);
  (osmd as { render: () => void }).render();
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);

  const rows: Array<{ pitches: string[]; x: number; heads: number }> = [];
  const bySvg = new Map<SVGGraphicsElement, (typeof rows)[0]>();
  forEachGraphicalMeasure(osmd as never, (gmRaw) => {
    if (measureMxlFromGraphic(gmRaw) !== 2) return;
    const gm = gmRaw as Record<string, unknown>;
    for (const seRaw of (gm.staffEntries ?? []) as unknown[]) {
      const se = seRaw as Record<string, unknown>;
      for (const gveRaw of (se.graphicalVoiceEntries ?? []) as unknown[]) {
        const gve = gveRaw as Record<string, unknown>;
        for (const gnRaw of (gve.notes ?? []) as unknown[]) {
          const gn = gnRaw as Record<string, unknown>;
          const pitch = pitchFromVf(gn.vfpitch);
          if (!pitch) continue;
          const rules = (osmd as { EngravingRules?: { GNote?: (n: unknown) => unknown } }).EngravingRules;
          let sn: SVGGraphicsElement | null = null;
          try {
            const gnote = rules?.GNote?.(gn.sourceNote);
            const el = (gnote as { getSVGGElement?: () => SVGGraphicsElement | null })?.getSVGGElement?.();
            sn = (el?.closest?.('.vf-stavenote') as SVGGraphicsElement | null) ?? el ?? null;
          } catch {
            /* */
          }
          if (!sn) continue;
          const existing = bySvg.get(sn);
          if (existing) {
            if (!existing.pitches.includes(pitch)) existing.pitches.push(pitch);
            continue;
          }
          const x = columnX(sn);
          if (x == null) continue;
          const row = { pitches: [pitch], x, heads: sn.querySelectorAll('.vf-notehead').length };
          bySvg.set(sn, row);
          rows.push(row);
        }
      }
    }
  });
  rows.sort((a, b) => a.x - b.x);
  console.log('=== SVG columns after align ===');
  for (const r of rows) {
    console.log(`  [${r.pitches}] h=${r.heads} x=${r.x.toFixed(1)}`);
  }
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i]!.x - rows[i - 1]!.x;
    console.log(`  gap ${i - 1}→${i}: ${gap.toFixed(1)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
