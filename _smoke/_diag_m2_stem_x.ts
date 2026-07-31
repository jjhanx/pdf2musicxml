/**
 * m2 PR: compare notehead avg X vs stem X for opposite-head chords.
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
import { HITL_PLAY_ORDER_ATTR, applyPlayOrderLayoutToMeasure } from '../shared/musicXmlPlayOrder';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from '../src/osmdMeasureClick';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';

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
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}
function pitchFromVf(vfpitch: unknown): string | null {
  const raw = Array.isArray(vfpitch) ? vfpitch[0] : vfpitch;
  if (typeof raw !== 'string') return null;
  const m = /^([a-g])(b?)n\/(\d+)$/i.exec(raw.trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()}${m[2] === 'b' ? 'b' : ''}${m[3]}`;
}
function elemX(el: Element): number | null {
  const path = el.matches('path') ? el : el.querySelector('path');
  const d = path?.getAttribute('d');
  if (!d) return null;
  const m = /^M\s*([-\d.]+)/.exec(d.trim());
  if (!m) return null;
  let tx = 0;
  let cur: Element | null = path;
  while (cur) {
    const tr = cur.getAttribute?.('transform') ?? '';
    const tm = /translate\(\s*([-\d.]+)/.exec(tr);
    if (tm) tx += parseFloat(tm[1]!);
    cur = cur.parentElement;
  }
  return tx + parseFloat(m[1]!);
}
function noteheadXs(sn: SVGGraphicsElement): number[] {
  const xs: number[] = [];
  for (const path of sn.querySelectorAll('.vf-notehead path')) {
    const x = elemX(path);
    if (x != null) xs.push(x);
  }
  return xs;
}
function stemX(sn: SVGGraphicsElement): number | null {
  for (const sel of ['.vf-stem path', '.vf-stem', 'path.vf-stem']) {
    const el = sn.querySelector(sel);
    if (!el) continue;
    const x = elemX(el);
    if (x != null) return x;
  }
  // VexFlow sometimes puts stem as line
  for (const line of sn.querySelectorAll('line')) {
    const x1 = parseFloat(line.getAttribute('x1') ?? '');
    if (!Number.isFinite(x1)) continue;
    let tx = 0;
    let cur: Element | null = line;
    while (cur) {
      const tr = cur.getAttribute?.('transform') ?? '';
      const tm = /translate\(\s*([-\d.]+)/.exec(tr);
      if (tm) tx += parseFloat(tm[1]!);
      cur = cur.parentElement;
    }
    return tx + x1;
  }
  return null;
}

function buildPr(raw: string): string {
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
    // set POs for m2 like user: 1,2,3 on the three quarters
    if (measure.getAttribute('number') === '2') {
      const leaders = [...measure.children].filter(
        (c) => local(c) === 'note' && !c.querySelector('chord'),
      );
      const qs = leaders.filter((n) => (n.querySelector('duration')?.textContent ?? '') === '2');
      qs.forEach((n, i) => {
        const po = String(i + 1);
        let cur: Element | null = n;
        while (cur && local(cur) === 'note') {
          cur.setAttribute(HITL_PLAY_ORDER_ATTR, po);
          cur = cur.nextElementSibling;
          if (cur && (local(cur) !== 'note' || !cur.querySelector('chord'))) break;
        }
      });
      applyPlayOrderLayoutToMeasure(measure);
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

async function main() {
  execSync('python -c "import io,zipfile,xml.etree.ElementTree as ET; from pathlib import Path; z=zipfile.ZipFile(\'omr-work-4637986c.zip\'); d=z.read(\'review.mxl\'); i=zipfile.ZipFile(io.BytesIO(d)); xml=i.read([n for n in i.namelist() if n.endswith(\'.xml\') and \'META\' not in n.upper()][0]); Path(\'_smoke/_tmp_463_raw.xml\').write_bytes(xml); print(\'wrote\')"', {
    stdio: 'inherit',
  });
  const raw = fs.readFileSync('_smoke/_tmp_463_raw.xml', 'utf8');
  const forOsmd = buildPr(raw);
  const host = document.getElementById('host')!;
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, forOsmd);
  await (osmd as { load: (x: string) => Promise<void> }).load(forOsmd);
  (osmd as { render: () => void }).render();

  console.log('=== BEFORE align (m2) ===');
  const rows: Array<{ pitches: string[]; heads: number; avg: number; stem: number | null; xs: number[] }> = [];
  forEachGraphicalMeasure(osmd as never, (gmRaw) => {
    if (measureMxlFromGraphic(gmRaw) !== 2) return;
    const gm = asRecord(gmRaw);
    const bySvg = new Map<SVGGraphicsElement, (typeof rows)[0]>();
    for (const seRaw of (gm?.staffEntries ?? []) as unknown[]) {
      const se = asRecord(seRaw);
      for (const gveRaw of (se?.graphicalVoiceEntries ?? []) as unknown[]) {
        const gve = asRecord(gveRaw);
        for (const gnRaw of (gve?.notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          const pitch = pitchFromVf(gn?.vfpitch);
          if (!pitch) continue;
          const rules = asRecord(asRecord(osmd)?.EngravingRules);
          let sn: SVGGraphicsElement | null = null;
          try {
            const gnote = (rules?.GNote as ((n: unknown) => unknown) | undefined)?.(gn?.sourceNote);
            const el = (asRecord(gnote) as { getSVGGElement?: () => SVGGraphicsElement | null } | null)
              ?.getSVGGElement?.();
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
          const xs = noteheadXs(sn);
          if (!xs.length) continue;
          const row = {
            pitches: [pitch],
            heads: xs.length,
            avg: xs.reduce((a, b) => a + b, 0) / xs.length,
            stem: stemX(sn),
            xs: xs.map((x) => Math.round(x * 10) / 10),
          };
          bySvg.set(sn, row);
          rows.push(row);
        }
      }
    }
  });
  for (const r of rows.sort((a, b) => a.avg - b.avg)) {
    console.log(
      `  [${r.pitches}] heads=${r.heads} avg=${r.avg.toFixed(1)} stem=${r.stem?.toFixed(1) ?? 'null'} xs=${r.xs}`,
    );
  }

  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);
  console.log('=== AFTER (avg still) — check class names ===');
  const sn = document.querySelector('.vf-stavenote');
  if (sn) console.log('sample innerHTML classes', [...sn.querySelectorAll('[class]')].map((e) => e.getAttribute('class')).slice(0, 20));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
