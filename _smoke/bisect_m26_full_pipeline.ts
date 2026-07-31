/**
 * Full-score m26: bisect which part causes OSMD width<=0 at measure 26.
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { measureMxlFromGraphic, partIdFromGraphic } from '../src/osmdMeasureClick.ts';

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

function maxStavesInPart(part: Element): number {
  let max = 1;
  part.querySelectorAll('note staff, note *|staff').forEach((el) => {
    const n = parseInt(el.textContent?.trim() ?? '1', 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  });
  return max;
}

function staffTimedNotesInMeasure(measure: Element) {
  type T = { note: Element; time: number; voice: string };
  const out: T[] = [];
  let pos = 0;
  const voicePos = new Map<string, number>();
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'backup') {
      const dur = parseInt(child.querySelector('duration, *|duration')?.textContent ?? '0', 10);
      pos = Math.max(0, pos - dur);
    } else if (tag === 'forward') {
      const dur = parseInt(child.querySelector('duration, *|duration')?.textContent ?? '0', 10);
      pos += dur;
    } else if (tag === 'note') {
      const isChord = !!child.querySelector(':scope > chord, :scope > *|chord');
      const isGrace = !!child.querySelector(':scope > grace, :scope > *|grace');
      const v = (child.querySelector(':scope > voice, :scope > *|voice')?.textContent ?? '1').trim() || '1';
      const dur = parseInt(child.querySelector(':scope > duration, :scope > *|duration')?.textContent ?? '0', 10);
      const t = voicePos.has(v) ? voicePos.get(v)! : pos;
      if (!isGrace && !isChord) out.push({ note: child, time: t, voice: v });
      if (!isGrace && !isChord) {
        voicePos.set(v, t + dur);
        pos = Math.max(pos, t + dur);
      }
    }
  }
  return out;
}

function noteDurationN(note: Element): number {
  return parseInt(note.querySelector(':scope > duration, :scope > *|duration')?.textContent ?? '0', 10);
}

function isChordNote(note: Element): boolean {
  return !!note.querySelector(':scope > chord, :scope > *|chord');
}

function staffVoicesOverlap(timed: { time: number; voice: string; note: Element }[]): boolean {
  const spans = timed
    .filter((x) => !isChordNote(x.note))
    .map((x) => ({ voice: x.voice, start: x.time, end: x.time + noteDurationN(x.note) }));
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
  if (timed.length < 2) return;
  const voices = new Set(timed.map((x) => x.voice));
  if (voices.size < 2) return;
  if (staffVoicesOverlap(timed)) return;
  timed.sort((a, b) => a.time - b.time || Number(a.voice) - Number(b.voice));
  const doc = measure.ownerDocument!;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const mk = (name: string) => (ns ? doc.createElementNS(ns, name) : doc.createElement(name));
  for (const el of [...measure.children].filter((c) => ['note', 'backup', 'forward'].includes(local(c)))) {
    measure.removeChild(el);
  }
  let insertAt = 0;
  for (const c of [...measure.children]) {
    const t = local(c);
    if (t !== 'attributes' && t !== 'print' && !(t === 'barline' && c.getAttribute('location') === 'right')) {
      insertAt = [...measure.children].indexOf(c);
      break;
    }
    insertAt++;
  }
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
    clone.querySelectorAll('voice, *|voice').forEach((v) => {
      v.textContent = '1';
    });
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
    for (let j = idx - 1; j >= 0; j--) {
      if (local(measure.children[j]!) === 'note') {
        prevStaff = noteStaff(measure.children[j] as Element);
        break;
      }
    }
    let nextStaff: number | null = null;
    for (let j = idx + 1; j < measure.children.length; j++) {
      if (local(measure.children[j]!) === 'note') {
        nextStaff = noteStaff(measure.children[j] as Element);
        break;
      }
    }
    if (nextStaff !== staffN) child.remove();
    else if (prevStaff === null || prevStaff !== staffN) child.remove();
  }
}

function transformPartToSingleStaff(part: Element, staffN: number): void {
  for (const meas of [...part.children]) {
    if (local(meas) !== 'measure') continue;
    for (const note of [...meas.querySelectorAll('note, *|note')]) {
      if (noteStaff(note) !== staffN) note.remove();
    }
    meas.querySelectorAll('note staff, note *|staff').forEach((el) => {
      el.textContent = '1';
    });
    pruneCrossStaffTimeline(meas, staffN);
    flattenNonOverlappingStaffVoicesForOsmd(meas);
  }
}

function splitGrandStaff(xml: string): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse');
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id');
    if (!pid || pid.includes('__')) continue;
    if (maxStavesInPart(part) < 2) continue;
    const pr = part.cloneNode(true) as Element;
    const pl = part.cloneNode(true) as Element;
    pr.setAttribute('id', `${pid}__PR`);
    pl.setAttribute('id', `${pid}__PL`);
    transformPartToSingleStaff(pr, 1);
    transformPartToSingleStaff(pl, 2);
    const parent = part.parentNode;
    if (parent) {
      parent.insertBefore(pr, part);
      parent.insertBefore(pl, part);
      parent.removeChild(part);
    }
    if (partList) {
      const sp = [...partList.children].find((c) => local(c) === 'score-part' && c.getAttribute('id') === pid);
      if (sp) {
        const mk = (id: string) => {
          const n = sp.cloneNode(false) as Element;
          n.setAttribute('id', id);
          return n;
        };
        partList.insertBefore(mk(`${pid}__PR`), sp);
        partList.insertBefore(mk(`${pid}__PL`), sp);
        partList.removeChild(sp);
      }
    }
  }
  return serializeMusicXmlDocument(doc);
}

function buildPreview(raw: string): string {
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

function filterParts(xml: string, partIds: string[]): string {
  const doc = parseMusicXmlDocument(xml)!;
  const keep = new Set(partIds);
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    if (!keep.has(part.getAttribute('id') ?? '')) part.parentNode?.removeChild(part);
  }
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  if (partList) {
    for (const sp of [...partList.children]) {
      if (local(sp) === 'score-part' && !keep.has(sp.getAttribute('id') ?? '')) partList.removeChild(sp);
    }
  }
  return serializeMusicXmlDocument(doc);
}

function readW(gm: Record<string, unknown>): number {
  const bb = gm.PositionAndShape ?? gm.positionAndShape;
  const size = (bb as Record<string, unknown>)?.Size ?? (bb as Record<string, unknown>)?.size;
  return Number((size as Record<string, unknown>)?.width ?? (size as Record<string, unknown>)?.Width ?? 0);
}

function firstPitch(gm: Record<string, unknown>): string | null {
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
        const pitch = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
        if (!pitch) continue;
        const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const fn = pitch.FundamentalNote ?? pitch.fundamentalNote;
        const oct = pitch.Octave ?? pitch.octave;
        if (typeof fn === 'number' && typeof oct === 'number') return `${names[fn] ?? fn}${oct}`;
      }
    }
  }
  return null;
}

async function probe(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(xml);
  osmd.zoom = 0.42;
  osmd.render();
  const sheet = (osmd as unknown as Record<string, unknown>).GraphicSheet as { MeasureList?: Record<string, unknown>[][] };
  const rows = sheet?.MeasureList ?? [];
  for (let si = 0; si < Math.min(rows.length, 3); si++) {
    const row = rows[si] ?? [];
    for (const gm of row) {
      if (!gm) continue;
      const n = measureMxlFromGraphic(gm as Record<string, unknown>);
      if (n == null || n < 25 || n > 27) continue;
      const pid = partIdFromGraphic(gm as Record<string, unknown>);
      const w = readW(gm as Record<string, unknown>);
      const p = firstPitch(gm as Record<string, unknown>);
      console.log(label, `st${si}`, pid, `m${n}`, `w=${w.toFixed(1)}`, `pitch=${p}`);
    }
  }
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const full = buildPreview(raw);
  await probe('FULL', full);

  const parts = ['P1', 'P2', 'P3', 'P4', 'P5__PR', 'P5__PL'];
  for (const p of parts) {
    await probe(p, filterParts(full, [p]));
  }
  for (let i = 1; i <= parts.length; i++) {
    await probe(parts.slice(0, i).join('+'), filterParts(full, parts.slice(0, i)));
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
