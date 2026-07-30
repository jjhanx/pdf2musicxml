/**
 * m2 opposite-notehead chord: stem-based column so gaps to neighbors are balanced.
 * Run: npx tsx _smoke/test_m2_opposite_head_spacing.ts
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
function svgUserX(el: Element, localX: number): number {
  let tx = 0;
  let cur: Element | null = el;
  while (cur) {
    const tr = cur.getAttribute?.('transform') ?? '';
    const tm = /translate\(\s*([-\d.]+)/.exec(tr);
    if (tm) tx += parseFloat(tm[1]!);
    cur = cur.parentElement;
  }
  return tx + localX;
}
function columnX(sn: SVGGraphicsElement): number | null {
  const stemRoot = sn.querySelector('.vf-stem');
  if (stemRoot) {
    for (const path of stemRoot.querySelectorAll('path')) {
      const d = path.getAttribute('d');
      const m = d && /^M\s*([-\d.]+)/.exec(d.trim());
      if (m) return svgUserX(path, parseFloat(m[1]!));
    }
    for (const line of stemRoot.querySelectorAll('line')) {
      const x1 = parseFloat(line.getAttribute('x1') ?? '');
      if (Number.isFinite(x1)) return svgUserX(line, x1);
    }
  }
  const xs: number[] = [];
  for (const path of sn.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    const m = d && /^M\s*([-\d.]+)/.exec(d.trim());
    if (m) xs.push(svgUserX(path, parseFloat(m[1]!)));
  }
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
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
          const next = cur.nextElementSibling;
          if (!next || local(next) !== 'note' || !next.querySelector('chord')) break;
          cur = next;
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

type Hit = { pitches: string[]; x: number; heads: number };

function collectM2(osmd: unknown): Hit[] {
  const bySvg = new Map<SVGGraphicsElement, Hit>();
  forEachGraphicalMeasure(osmd as never, (gmRaw) => {
    if (measureMxlFromGraphic(gmRaw) !== 2) return;
    const gm = asRecord(gmRaw);
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
          const x = columnX(sn);
          if (x == null) continue;
          bySvg.set(sn, {
            pitches: [pitch],
            x,
            heads: sn.querySelectorAll('.vf-notehead').length,
          });
        }
      }
    }
  });
  return [...bySvg.values()].sort((a, b) => a.x - b.x);
}

async function main() {
  if (!fs.existsSync('omr-work-4637986c.zip')) {
    console.log('skip');
    return;
  }
  execSync(
    'python -c "import io,zipfile; from pathlib import Path; z=zipfile.ZipFile(\'omr-work-4637986c.zip\'); d=z.read(\'review.mxl\'); i=zipfile.ZipFile(io.BytesIO(d)); xml=i.read([n for n in i.namelist() if n.endswith(\'.xml\') and \'META\' not in n.upper()][0]); Path(\'_smoke/_tmp_463_raw.xml\').write_bytes(xml)"',
    { stdio: 'inherit' },
  );
  const raw = fs.readFileSync('_smoke/_tmp_463_raw.xml', 'utf8');
  const forOsmd = buildPr(raw);
  const host = document.getElementById('host')!;
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, forOsmd);
  await (osmd as { load: (x: string) => Promise<void> }).load(forOsmd);
  (osmd as { render: () => void }).render();
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);

  const hits = collectM2(osmd);
  const quarters = hits.filter((h) => h.heads >= 2);
  if (quarters.length < 3) {
    throw new Error(`need 3 quarter chords, got ${JSON.stringify(hits)}`);
  }
  // musical: wide, second(opposite), triad — identify opposite by B+C pair
  const opposite = quarters.find((h) => h.pitches.includes('B4') && h.pitches.includes('C5'));
  const others = quarters.filter((h) => h !== opposite).sort((a, b) => a.x - b.x);
  if (!opposite || others.length < 2) {
    throw new Error(`opposite [B4,C5] not found: ${JSON.stringify(quarters)}`);
  }
  const left = others[0]!;
  const right = others[1]!;
  // ensure opposite is between them in x after align
  const mid = opposite;
  if (!(left.x < mid.x && mid.x < right.x)) {
    // reorder by x among the three
    const three = [left, mid, right].sort((a, b) => a.x - b.x);
    const gapL = three[1]!.x - three[0]!.x;
    const gapR = three[2]!.x - three[1]!.x;
    const ratio = Math.max(gapL, gapR) / Math.max(1, Math.min(gapL, gapR));
    if (ratio > 1.35) {
      throw new Error(`opposite-head gaps unbalanced: gapL=${gapL.toFixed(1)} gapR=${gapR.toFixed(1)} ratio=${ratio.toFixed(2)}`);
    }
    console.log('OK m2 opposite-head spacing', { gapL, gapR, ratio, three: three.map((t) => t.pitches) });
    return;
  }
  const gapL = mid.x - left.x;
  const gapR = right.x - mid.x;
  const ratio = Math.max(gapL, gapR) / Math.max(1, Math.min(gapL, gapR));
  if (ratio > 1.35) {
    throw new Error(`opposite-head gaps unbalanced: gapL=${gapL.toFixed(1)} gapR=${gapR.toFixed(1)} ratio=${ratio.toFixed(2)}`);
  }
  console.log('OK m2 opposite-head spacing', {
    gapL,
    gapR,
    ratio,
    left: left.pitches,
    mid: mid.pitches,
    right: right.pitches,
  });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
