/**
 * OSMD graphic X for m17 PR after linkParallel + full preview transforms.
 * Run: npx tsx _smoke/test_m17_osmd_graphic_align.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
const OpenSheetMusicDisplay =
  (osmdLib as { OpenSheetMusicDisplay?: typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay })
    .OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay } })
    .default?.OpenSheetMusicDisplay;
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
const g = globalThis as Record<string, unknown>;
Object.assign(g, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

type TimedNote = { note: Element; time: number; voice: string; end: number };

function noteDurationN(note: Element): number {
  const d = note.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(d?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function noteVoiceN(note: Element): string {
  return note.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || '1';
}

function isChordNote(note: Element): boolean {
  return note.querySelector('chord, *|chord') !== null;
}

function staffTimedNotesInMeasure(measure: Element): TimedNote[] {
  const voiceCursor = new Map<string, number>();
  let lastNoteVoice = '1';
  const out: TimedNote[] = [];
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'backup') {
      const v =
        child.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || lastNoteVoice;
      const dur = parseInt(child.querySelector('duration, *|duration')?.textContent?.trim() ?? '0', 10);
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - (Number.isFinite(dur) ? dur : 0)));
    } else if (tag === 'forward') {
      const v =
        child.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || lastNoteVoice;
      const dur = parseInt(child.querySelector('duration, *|duration')?.textContent?.trim() ?? '0', 10);
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + (Number.isFinite(dur) ? dur : 0));
    } else if (tag === 'note') {
      const voice = noteVoiceN(child);
      lastNoteVoice = voice;
      const t = voiceCursor.get(voice) ?? 0;
      const dur = noteDurationN(child);
      const end = isChordNote(child) ? t : t + dur;
      out.push({ note: child, time: t, voice, end });
      if (!isChordNote(child)) voiceCursor.set(voice, end);
    }
  }
  return out;
}

function staffVoicesOverlap(timed: TimedNote[]): boolean {
  const byVoice = new Map<string, Array<{ start: number; end: number }>>();
  for (const { voice, time, end } of timed) {
    const list = byVoice.get(voice) ?? [];
    list.push({ start: time, end });
    byVoice.set(voice, list);
  }
  const voices = [...byVoice.keys()];
  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      for (const a of byVoice.get(voices[i]!)!) {
        for (const b of byVoice.get(voices[j]!)!) {
          if (Math.max(a.start, b.start) < Math.min(a.end, b.end)) return true;
        }
      }
    }
  }
  return false;
}

function flattenNonOverlappingStaffVoicesForOsmd(measure: Element): void {
  const timed = staffTimedNotesInMeasure(measure);
  if (timed.length < 2) return;
  if (new Set(timed.map((x) => x.voice)).size < 2) return;
  if (measureHasLeadingForward(measure)) return;
  if (staffVoicesOverlap(timed)) return;
  timed.sort((a, b) => a.time - b.time || Number(a.voice) - Number(b.voice));
  const doc = measure.ownerDocument!;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const mk = (name: string) => (ns ? doc.createElementNS(ns, name) : doc.createElement(name));
  for (const el of [...measure.children]) {
    const tag = local(el);
    if (tag === 'note' || tag === 'backup' || tag === 'forward') measure.removeChild(el);
  }
  let insertAt = 0;
  while (insertAt < measure.children.length) {
    const tag = local(measure.children[insertAt]!);
    if (tag !== 'attributes' && tag !== 'print') break;
    insertAt++;
  }
  let cursor = 0;
  for (const { note, time } of timed) {
    if (time > cursor) {
      const fwd = mk('forward');
      fwd.appendChild(Object.assign(mk('duration'), { textContent: String(time - cursor) }));
      measure.insertBefore(fwd, measure.children[insertAt] ?? null);
      insertAt++;
      cursor = time;
    }
    const clone = note.cloneNode(true) as Element;
    clone.querySelectorAll('voice, *|voice').forEach((v) => {
      v.textContent = '1';
    });
    measure.insertBefore(clone, measure.children[insertAt] ?? null);
    insertAt++;
    if (!isChordNote(clone)) cursor = time + noteDurationN(clone);
  }
}

function buildPrPreviewXml(rawXml: string): string {
  let xml = repairTimelineForOsmdPreview(rawXml);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5');
  if (!part) throw new Error('P5 missing');
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (local(child) === 'note') {
        const st = child.querySelector('staff, *|staff')?.textContent?.trim();
        if (st && st !== '1') child.remove();
      }
    }
    measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
      el.textContent = '1';
    });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    flattenNonOverlappingStaffVoicesForOsmd(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  xml = new XMLSerializer().serializeToString(doc);
  xml = repairTimelineForOsmdPreview(xml);
  return xml;
}

function measureHasLeadingForward(measure: Element): boolean {
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'forward') return true;
    if (tag === 'note') return false;
  }
  return false;
}

function pitchLabel(src: Record<string, unknown>): string {
  const pitch = src.Pitch ?? src.pitch;
  if (!pitch || typeof pitch !== 'object') return '?';
  const p = pitch as Record<string, unknown>;
  const step = String(p.FundamentalNote ?? p.fundamentalNote ?? '?');
  const oct = String(p.Octave ?? p.octave ?? '');
  return step + oct;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip: zip not found');
    return;
  }
  const rawXml = execSync('python _smoke/_export_m17_parallel_fix.py', {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const preview = buildPrPreviewXml(rawXml);
  fs.writeFileSync('_smoke/_m17_osmd_preview.xml', preview);

  const badDur = preview.match(/<duration>\s*[^0-9\s][^<]*\s*<\/duration>/g);
  const badType = preview.match(/<type>\s*u\s*<\/type>/g);
  console.log('bad duration tags:', badDur?.slice(0, 5) ?? 'none');
  console.log('bad type u:', badType?.length ?? 0);

  const host = document.getElementById('host')!;
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawMeasureNumbers: false,
  });
  await osmd.load(preview);
  osmd.render();

  const sheet = (osmd as unknown as { graphic?: { MeasureList?: unknown[] } }).graphic;
  const measures = (sheet?.MeasureList ?? []) as Record<string, unknown>[];
  const m17 = measures.find((m) => Number(m.MeasureNumber ?? m.measureNumber ?? 0) === 17);
  if (!m17) throw new Error('OSMD m17 not found');

  const xs: Record<string, number[]> = {};
  const staffEntries = (m17.staffEntries ?? m17.StaffEntries ?? []) as Record<string, unknown>[];
  for (const se of staffEntries) {
    const gves = (se.graphicalVoiceEntries ??
      se.GraphicalVoiceEntries ??
      []) as Record<string, unknown>[];
    for (const gve of gves) {
      const pos = (gve.PositionAndShape ?? gve.positionAndShape) as
        | Record<string, unknown>
        | undefined;
      const rel = (pos?.RelativePosition ?? pos?.relativePosition) as
        | Record<string, unknown>
        | undefined;
      const x = Number(rel?.x ?? rel?.X ?? NaN);
      const notes = (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[];
      for (const n of notes) {
        const src = (n.sourceNote ?? n.SourceNote ?? n) as Record<string, unknown>;
        const label = pitchLabel(src);
        if (!xs[label]) xs[label] = [];
        if (Number.isFinite(x)) xs[label].push(x);
      }
    }
  }

  console.log('OSMD graphic X samples:', xs);
  const f4x = xs.F4?.[0];
  const e5x = xs.E5?.[0];
  if (f4x == null || e5x == null) throw new Error('F4 or E5 not in graphic sheet');
  if (Math.abs(f4x - e5x) > 0.05) {
    throw new Error(`OSMD graphic misalign F4 x=${f4x} E5 x=${e5x}`);
  }
  console.log('m17 OSMD graphic align ok', { f4x, e5x });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
