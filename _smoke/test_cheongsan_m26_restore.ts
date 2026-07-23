/**
 * 청산 HITL preview — P1 m26 must show D5 (번뇌 시름다), not Audiveris F5/C5 miss.
 * Run: npx tsx _smoke/test_cheongsan_m26_restore.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { measureMxlFromGraphic, forEachOsmdSystem, partIdFromGraphic } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:12000px"></div></body></html>');
Object.assign(globalThis, {
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

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function noteStaff(note: Element): number {
  return parseInt(note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() ?? '1', 10) || 1;
}

function noteDurationN(note: Element): number {
  return parseInt(note.querySelector(':scope > duration, :scope > *|duration')?.textContent ?? '0', 10);
}

function isChordNote(note: Element): boolean {
  return !!note.querySelector(':scope > chord, :scope > *|chord');
}

function staffTimedNotesInMeasure(measure: Element) {
  type T = { note: Element; time: number; voice: string };
  const out: T[] = [];
  let pos = 0;
  const voicePos = new Map<string, number>();
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'backup') pos = Math.max(0, pos - noteDurationN(child));
    else if (tag === 'forward') pos += noteDurationN(child);
    else if (tag === 'note') {
      if (isChordNote(child) || child.querySelector(':scope > grace, :scope > *|grace')) continue;
      const v = (child.querySelector(':scope > voice, :scope > *|voice')?.textContent ?? '1').trim() || '1';
      const t = voicePos.has(v) ? voicePos.get(v)! : pos;
      out.push({ note: child, time: t, voice: v });
      voicePos.set(v, t + noteDurationN(child));
      pos = Math.max(pos, t + noteDurationN(child));
    }
  }
  return out;
}

function staffVoicesOverlap(timed: { time: number; voice: string; note: Element }[]): boolean {
  const spans = timed.filter((x) => !isChordNote(x.note)).map((x) => ({ voice: x.voice, start: x.time, end: x.time + noteDurationN(x.note) }));
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[i]!.voice === spans[j]!.voice) continue;
      const a = spans[i]!;
      const b = spans[j]!;
      if (a.start < b.end && b.start < a.end) return true;
    }
  }
  return false;
}

function flattenNonOverlappingStaffVoicesForOsmd(measure: Element): void {
  const timed = staffTimedNotesInMeasure(measure);
  if (timed.length < 2 || new Set(timed.map((x) => x.voice)).size < 2) return;
  if (staffVoicesOverlap(timed)) return;
  timed.sort((a, b) => a.time - b.time || Number(a.voice) - Number(b.voice));
  const doc = measure.ownerDocument!;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const mk = (name: string) => (ns ? doc.createElementNS(ns, name) : doc.createElement(name));
  for (const el of [...measure.children].filter((c) => ['note', 'backup', 'forward'].includes(local(c)))) measure.removeChild(el);
  let insertAt = [...measure.children].findIndex((c) => !['attributes', 'print'].includes(local(c)) && !(local(c) === 'barline' && c.getAttribute('location') === 'right'));
  if (insertAt < 0) insertAt = measure.children.length;
  let cursor = 0;
  for (const { note, time } of timed) {
    if (time > cursor) {
      const fwd = mk('forward');
      const durEl = mk('duration');
      durEl.textContent = String(time - cursor);
      fwd.appendChild(durEl);
      measure.insertBefore(fwd, measure.children[insertAt] ?? null);
      insertAt++;
      cursor = time;
    }
    const clone = note.cloneNode(true) as Element;
    clone.querySelectorAll('voice, *|voice').forEach((v) => { v.textContent = '1'; });
    measure.insertBefore(clone, measure.children[insertAt] ?? null);
    insertAt++;
    if (!isChordNote(clone)) cursor = time + noteDurationN(clone);
  }
}

function pruneCrossStaffTimeline(measure: Element, staffN: number): void {
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag !== 'backup' && tag !== 'forward') continue;
    const idx = [...measure.children].indexOf(child);
    let prevStaff: number | null = null;
    for (let j = idx - 1; j >= 0; j--) if (local(measure.children[j]!) === 'note') { prevStaff = noteStaff(measure.children[j] as Element); break; }
    let nextStaff: number | null = null;
    for (let j = idx + 1; j < measure.children.length; j++) if (local(measure.children[j]!) === 'note') { nextStaff = noteStaff(measure.children[j] as Element); break; }
    if (nextStaff !== staffN) child.remove();
    else if (prevStaff === null || prevStaff !== staffN) child.remove();
  }
}

function splitGrandStaff(xml: string): string {
  const doc = parseMusicXmlDocument(xml)!;
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id');
    if (!pid || pid.includes('__')) continue;
    let max = 1;
    part.querySelectorAll('note staff, note *|staff').forEach((s) => { max = Math.max(max, parseInt(s.textContent ?? '1', 10)); });
    if (max < 2) continue;
    const mkPart = (sn: number, suf: string) => {
      const p = part.cloneNode(true) as Element;
      p.setAttribute('id', `${pid}__${suf}`);
      for (const m of [...p.children]) {
        if (local(m) !== 'measure') continue;
        for (const n of [...m.querySelectorAll('note')]) if (noteStaff(n) !== sn) n.remove();
        m.querySelectorAll('note staff, note *|staff').forEach((s) => { s.textContent = '1'; });
        pruneCrossStaffTimeline(m, sn);
        flattenNonOverlappingStaffVoicesForOsmd(m);
      }
      return p;
    };
    part.parentNode!.insertBefore(mkPart(1, 'PR'), part);
    part.parentNode!.insertBefore(mkPart(2, 'PL'), part);
    part.parentNode!.removeChild(part);
    if (partList) {
      const sp = [...partList.children].find((c) => local(c) === 'score-part' && c.getAttribute('id') === pid);
      if (sp) {
        const cl = (id: string) => { const n = sp.cloneNode(false) as Element; n.setAttribute('id', id); return n; };
        partList.insertBefore(cl(`${pid}__PR`), sp);
        partList.insertBefore(cl(`${pid}__PL`), sp);
        partList.removeChild(sp);
      }
    }
  }
  return serializeMusicXmlDocument(doc);
}

function buildHitlPreview(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  xml = splitGrandStaff(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = repairMissingNoteTypesForOsmdPreview(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  const doc = parseMusicXmlDocument(xml);
  doc?.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return doc ? serializeMusicXmlDocument(doc) : xml;
}

function osmdPitchToken(p: Record<string, unknown>): string {
  return `fn${p.FundamentalNote}/oct${p.Octave}`;
}

function p1MeasureTokens(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mn: number): string[] {
  const out: string[] = [];
  const sheet = (osmd as unknown as { Sheet?: { SourceMeasures?: Array<Record<string, unknown>> } }).Sheet;
  for (const sm of sheet?.SourceMeasures ?? []) {
    if (Number(sm.MeasureNumberXML ?? sm.MeasureNumber) !== mn) continue;
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      for (const se of ((c as Record<string, unknown>).StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        const inst = (se as Record<string, unknown>).ParentStaff as Record<string, unknown> | undefined;
        const instr = inst?.ParentInstrument as Record<string, unknown> | undefined;
        if (String(instr?.IdString ?? '') !== 'P1') continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          for (const n of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            const p = (n as Record<string, unknown>).Pitch as Record<string, unknown> | undefined;
            if (p) out.push(osmdPitchToken(p));
          }
        }
      }
    }
  }
  return out;
}

function graphicFirstToken(gm: Record<string, unknown>): string | null {
  const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
  for (const entry of entries ?? []) {
    const er = entry as Record<string, unknown>;
    const gves = (er.graphicalVoiceEntries ?? er.GraphicalVoiceEntries) as unknown[] | undefined;
    for (const gve of gves ?? []) {
      const gr = gve as Record<string, unknown>;
      const notes = (gr.notes ?? gr.Notes) as unknown[] | undefined;
      for (const note of notes ?? []) {
        const nr = note as Record<string, unknown>;
        const src = (nr.sourceNote ?? nr.SourceNote) as Record<string, unknown> | undefined;
        const p = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
        if (p) return osmdPitchToken(p);
      }
    }
  }
  return null;
}

async function main() {
  const xml = buildHitlPreview(readFileSync('_smoke/_cheongsan_review.xml', 'utf8'));
  if (!/<print[^>]*new-system="yes"/i.test(xml)) throw new Error('expected minimal new-system print breaks');
  if (/<print[^>]*>\s*<system-layout/i.test(xml)) throw new Error('system-layout must not remain');

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(xml);
  osmd.zoom = 0.35;
  osmd.render();

  const m26 = p1MeasureTokens(osmd, 26);
  const m27 = p1MeasureTokens(osmd, 27);
  console.log('P1 m26', m26);
  console.log('P1 m27', m27);

  if (m26[0] !== 'fn2/oct2') throw new Error(`P1 m26 first pitch wrong: ${JSON.stringify(m26)}`);
  if (m27[0] === m26[0] && m27[1] === m26[1]) throw new Error('P1 m26 equals m27 — measure shift');

  let g26: string | null = null;
  let g27: string | null = null;
  forEachOsmdSystem(osmd, (_s, rows) => {
    for (const gm of rows[0] ?? []) {
      if (!gm) continue;
      if (partIdFromGraphic(gm as Record<string, unknown>) !== 'P1') continue;
      const n = measureMxlFromGraphic(gm as Record<string, unknown>);
      if (n === 26) g26 = graphicFirstToken(gm as Record<string, unknown>);
      if (n === 27) g27 = graphicFirstToken(gm as Record<string, unknown>);
    }
  });
  console.log('graphic P1 m26', g26, 'm27', g27);
  if (g26 !== 'fn2/oct2') throw new Error(`graphic P1 m26 pitch wrong: ${g26}`);
  if (g26 === g27) throw new Error('graphic P1 m26 equals m27');

  console.log('cheongsan m26 restore ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
