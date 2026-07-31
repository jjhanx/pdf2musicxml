/**
 * Dump m17 linked-parallel hints + grid align wantX for each hit.
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
  collectLinkedParallelOnsetHintsFromXml,
} from '../shared/musicXmlTimelineCleanup';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
import { collectPreviewNoteLayoutTargetsFromXml, HITL_PLAY_ORDER_ATTR } from '../shared/musicXmlPlayOrder';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
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
    else xs.push(parseFloat(m[1]!));
  }
  if (!xs.length) return null;
  const base = xs.reduce((a, b) => a + b, 0) / xs.length;
  // jsdom CTM often omits element translate — add stavenote translate for visual X
  const tr = sn.getAttribute('transform') ?? '';
  const tm = /translate\(\s*([-\d.]+)/.exec(tr);
  return base + (tm ? parseFloat(tm[1]!) : 0);
}
function voiceFromGn(gn: Record<string, unknown>): string {
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  const pve = asRecord(src?.ParentVoiceEntry ?? src?.parentVoiceEntry);
  const pv = asRecord(pve?.ParentVoice ?? pve?.parentVoice);
  const id = pv?.VoiceId ?? pv?.voiceId;
  return typeof id === 'number' || typeof id === 'string' ? String(id) : '?';
}

function buildPrLike(raw: string): string {
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
    realignMeasureDefaultXFromTimelineForOsmd(measure);
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

function collectHits(osmd: unknown) {
  const out: Array<{
    pitches: string[];
    voice: string;
    x: number;
    heads: number;
    tr: string | null;
    ts: number | null;
  }> = [];
  const bySvg = new Map<SVGGraphicsElement, (typeof out)[0]>();
  forEachGraphicalMeasure(osmd as never, (gmRaw) => {
    if (measureMxlFromGraphic(gmRaw) !== 17) return;
    const gm = asRecord(gmRaw);
    if (!gm) return;
    for (const seRaw of (gm.staffEntries ?? []) as unknown[]) {
      const se = asRecord(seRaw);
      if (!se) continue;
      for (const gveRaw of (se.graphicalVoiceEntries ?? []) as unknown[]) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        const pve = asRecord(gve.parentVoiceEntry);
        const tsRaw = pve?.Timestamp ?? pve?.timestamp;
        let ts: number | null = null;
        if (typeof tsRaw === 'number') ts = tsRaw;
        else {
          const r = asRecord(tsRaw);
          if (typeof r?.realValue === 'number') ts = r.realValue;
        }
        for (const gnRaw of (gve.notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          if (!gn) continue;
          const pitch = pitchFromVf(gn.vfpitch ?? gn.vfPitch);
          if (!pitch) continue;
          const src = asRecord(gn.sourceNote);
          const rules = asRecord(asRecord(osmd)?.EngravingRules);
          let stavenote: SVGGraphicsElement | null = null;
          try {
            const gnote = (rules?.GNote as ((n: unknown) => unknown) | undefined)?.(src);
            const svgEl = (asRecord(gnote) as { getSVGGElement?: () => SVGGraphicsElement | null } | null)
              ?.getSVGGElement?.();
            stavenote =
              (svgEl?.closest?.('.vf-stavenote') as SVGGraphicsElement | null) ?? svgEl ?? null;
          } catch {
            /* */
          }
          if (!stavenote) continue;
          const existing = bySvg.get(stavenote);
          if (existing) {
            if (!existing.pitches.includes(pitch)) existing.pitches.push(pitch);
            continue;
          }
          const x = noteheadX(stavenote);
          if (x == null) continue;
          const row = {
            pitches: [pitch],
            voice: voiceFromGn(gn),
            x,
            heads: stavenote.querySelectorAll('.vf-notehead').length,
            tr: stavenote.getAttribute('transform'),
            ts,
          };
          bySvg.set(stavenote, row);
          out.push(row);
        }
      }
    }
  });
  return out.sort((a, b) => a.x - b.x);
}

async function main() {
  execSync('python _smoke/_export_463_po.py', { stdio: 'inherit' });
  const raw = fs.readFileSync('_smoke/_tmp_463_po_fixed.xml', 'utf8');
  const forOsmd = buildPrLike(raw);

  const hints = collectLinkedParallelOnsetHintsFromXml(forOsmd).filter((h) => h.measureNumber === 17);
  console.log('=== m17 linked hints ===');
  for (const h of hints) {
    console.log(JSON.stringify({ onset: h.onset, pitches: h.memberPitches, voices: h.memberVoices, anchor: h.anchorPitch }));
  }

  const targets = collectPreviewNoteLayoutTargetsFromXml(forOsmd).filter(
    (t) => t.measureNumber === 17 && t.playOrder != null,
  );
  console.log('=== targets ===');
  for (const t of targets) console.log(`  ${t.pitch} v=${t.voice} po=${t.playOrder} x=${t.defaultXTenths}`);

  // Check XML attrs on G chord
  const doc = new DOMParser().parseFromString(forOsmd, 'text/xml');
  const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  console.log('=== m17 notes with attrs ===');
  for (const c of [...m17.children]) {
    if (local(c) !== 'note') continue;
    const step = c.querySelector('step')?.textContent ?? '';
    const oct = c.querySelector('octave')?.textContent ?? '';
    const chord = c.querySelector('chord') ? 'chord' : 'leader';
    console.log(
      `  ${step}${oct} ${chord} v=${c.querySelector('voice')?.textContent} po=${c.getAttribute(HITL_PLAY_ORDER_ATTR)} dx=${c.getAttribute('default-x')} lx=${c.getAttribute('data-osmd-layout-x')}`,
    );
  }

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, forOsmd);
  await (osmd as { load: (x: string) => Promise<void> }).load(forOsmd);
  (osmd as { render: () => void }).render();
  console.log('=== BEFORE ===');
  for (const h of collectHits(osmd)) {
    console.log(`  [${h.pitches}] v=${h.voice} h=${h.heads} x=${h.x.toFixed(1)} ts=${h.ts} tr=${h.tr}`);
  }
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);
  console.log('=== AFTER ===');
  for (const h of collectHits(osmd)) {
    console.log(`  [${h.pitches}] v=${h.voice} h=${h.heads} x=${h.x.toFixed(1)} ts=${h.ts} tr=${h.tr}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
