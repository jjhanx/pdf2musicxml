/**
 * Deep diag: REAL HITL path (flatten + reorder + layout) — m17 before/after SVG.
 * Run: npx tsx _smoke/_diag_m17_align_real_path.ts
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
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
import { collectPreviewNoteLayoutTargetsFromXml, HITL_PLAY_ORDER_ATTR } from '../shared/musicXmlPlayOrder';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from '../src/osmdMeasureClick';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

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
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function voiceFromGn(gn: Record<string, unknown>): string {
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  const pve = asRecord(src?.ParentVoiceEntry ?? src?.parentVoiceEntry);
  const pv = asRecord(pve?.ParentVoice ?? pve?.parentVoice);
  const id = pv?.VoiceId ?? pv?.voiceId;
  return typeof id === 'number' || typeof id === 'string' ? String(id) : '?';
}

function noteDurationN(note: Element): number {
  const n = parseInt(note.querySelector(':scope > duration')?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}
function isChordNote(note: Element): boolean {
  return note.querySelector(':scope > chord') != null;
}
type Timed = { note: Element; time: number; voice: string; end: number };
function staffTimed(measure: Element): Timed[] {
  const voiceCursor = new Map<string, number>();
  let last = '1';
  const out: Timed[] = [];
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'backup') {
      const v = child.querySelector('voice')?.textContent?.trim() || last;
      const dur = parseInt(child.querySelector('duration')?.textContent ?? '0', 10) || 0;
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - dur));
    } else if (tag === 'forward') {
      const v = child.querySelector('voice')?.textContent?.trim() || last;
      const dur = parseInt(child.querySelector('duration')?.textContent ?? '0', 10) || 0;
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + dur);
    } else if (tag === 'note') {
      const voice = child.querySelector('voice')?.textContent?.trim() || '1';
      last = voice;
      const t = voiceCursor.get(voice) ?? 0;
      const dur = noteDurationN(child);
      const end = isChordNote(child) ? t : t + dur;
      out.push({ note: child, time: t, voice, end });
      if (!isChordNote(child)) voiceCursor.set(voice, end);
    }
  }
  return out;
}
function voicesOverlap(timed: Timed[]): boolean {
  const byV = new Map<string, Array<{ s: number; e: number }>>();
  for (const t of timed) {
    const list = byV.get(t.voice) ?? [];
    list.push({ s: t.time, e: t.end });
    byV.set(t.voice, list);
  }
  const vs = [...byV.keys()];
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      for (const a of byV.get(vs[i]!)!) {
        for (const b of byV.get(vs[j]!)!) {
          if (Math.max(a.s, b.s) < Math.min(a.e, b.e)) return true;
        }
      }
    }
  }
  return false;
}
function flattenIfSafe(measure: Element): void {
  const timed = staffTimed(measure);
  const voices = new Set(timed.map((t) => t.voice));
  if (voices.size < 2) {
    console.log('flatten: single voice, skip');
    return;
  }
  const leaders = timed.filter((t) => !isChordNote(t.note));
  console.log(
    'timed leaders',
    leaders.map((t) => {
      const step = t.note.querySelector('step')?.textContent ?? '';
      const oct = t.note.querySelector('octave')?.textContent ?? '';
      return { pitch: step + oct, v: t.voice, t: t.time, end: t.end, po: t.note.getAttribute(HITL_PLAY_ORDER_ATTR) };
    }),
  );
  if (voicesOverlap(timed)) {
    console.log('flatten SKIPPED (overlap)');
    return;
  }
  console.log('*** flatten RUNNING ***');
  timed.sort((a, b) => a.time - b.time || Number(a.voice) - Number(b.voice));
  const doc = measure.ownerDocument!;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const mk = (n: string) => (ns ? doc.createElementNS(ns, n) : doc.createElement(n));
  for (const el of [...measure.children].filter((c) => ['note', 'backup', 'forward'].includes(local(c)))) {
    measure.removeChild(el);
  }
  let insertAt = 0;
  for (let i = 0; i < measure.children.length; i++) {
    if (local(measure.children[i]!) === 'attributes' || local(measure.children[i]!) === 'print') continue;
    insertAt = i;
    break;
  }
  let cursor = 0;
  for (const { note, time } of timed) {
    if (time > cursor) {
      const fwd = mk('forward');
      const d = mk('duration');
      d.textContent = String(time - cursor);
      fwd.appendChild(d);
      measure.insertBefore(fwd, measure.children[insertAt] ?? null);
      insertAt++;
      cursor = time;
    }
    const clone = note.cloneNode(true) as Element;
    clone.querySelectorAll('voice').forEach((v) => {
      v.textContent = '1';
    });
    measure.insertBefore(clone, measure.children[insertAt] ?? null);
    insertAt++;
    if (!isChordNote(clone)) cursor = time + noteDurationN(clone);
  }
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
    measure.querySelectorAll('note staff').forEach((el) => {
      el.textContent = '1';
    });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    if (measure.getAttribute('number') === '17') flattenIfSafe(measure);
    else flattenIfSafe(measure);
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
  const out: Array<{ pitches: string[]; voice: string; x: number; heads: number; tr: string | null }> = [];
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

  const doc = new DOMParser().parseFromString(forOsmd, 'text/xml');
  const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  console.log('=== XML m17 after REAL path ===');
  for (const c of [...m17.children]) {
    if (local(c) === 'backup' || local(c) === 'forward') {
      console.log(`  <${local(c)}> dur=${c.querySelector('duration')?.textContent} v=${c.querySelector('voice')?.textContent}`);
      continue;
    }
    if (local(c) !== 'note' || c.querySelector('chord')) continue;
    const step = c.querySelector('step')?.textContent ?? '';
    const oct = c.querySelector('octave')?.textContent ?? '';
    const alter = c.querySelector('alter')?.textContent;
    const acc = alter === '-1' ? 'b' : '';
    console.log(
      `  ${step}${acc}${oct} v=${c.querySelector('voice')?.textContent} po=${c.getAttribute(HITL_PLAY_ORDER_ATTR)} lx=${c.getAttribute('data-osmd-layout-x')}`,
    );
  }
  const targets = collectPreviewNoteLayoutTargetsFromXml(forOsmd).filter(
    (t) => t.measureNumber === 17 && t.playOrder != null,
  );
  console.log('=== targets ===');
  for (const t of targets) console.log(`  ${t.pitch} v=${t.voice} po=${t.playOrder} x=${t.defaultXTenths}`);

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, forOsmd);
  await (osmd as { load: (x: string) => Promise<void> }).load(forOsmd);
  (osmd as { render: () => void }).render();
  console.log('=== BEFORE ===');
  for (const h of collectHits(osmd)) {
    console.log(`  [${h.pitches}] v=${h.voice} h=${h.heads} x=${h.x.toFixed(1)} tr=${h.tr}`);
  }
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, forOsmd);
  console.log('=== AFTER ===');
  for (const h of collectHits(osmd)) {
    console.log(`  [${h.pitches}] v=${h.voice} h=${h.heads} x=${h.x.toFixed(1)} tr=${h.tr}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
