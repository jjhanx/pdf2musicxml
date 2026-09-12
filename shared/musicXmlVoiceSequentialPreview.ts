/**
 * OSMD/HITL 미리보기 — 겹친 multi-voice(OMR 오인식)를 staff 내에서 시간순으로 펼침.
 * 저장 MXL은 변경하지 않음. flattenNonOverlappingStaffVoicesForOsmd는 겹침 시 skip.
 */
import { hitlPreviewPartIdsMatch } from './musicXmlArticulationDistance';
import { measureHeaderInsertIndex } from './musicXmlDirectionPlacement';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
import {
  realignMeasureDefaultXFromTimelineForOsmd,
  snapshotNoteDefaultXForOsmdPreview,
} from './musicXmlTimelineCleanup';

export type VoiceSequentialPreviewTarget = {
  partId: string;
  measureMxl: string | number;
  staffWithinPart?: number | null;
};

const HITL_SEQ_PREVIEW_ATTR = 'data-hitl-voice-seq-preview';
const HITL_PLAY_ORDER_ATTR = 'data-hitl-play-order';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function findXmlParts(doc: Document): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    if (xmlLocalName(el) === 'part') out.push(el);
    for (const c of [...el.children]) walk(c);
  };
  if (doc.documentElement) walk(doc.documentElement);
  return out;
}

function noteStaffN(noteEl: Element): number {
  const staffEl = noteEl.querySelector(':scope > staff, :scope > *|staff');
  if (!staffEl) return 1;
  const n = parseInt(staffEl.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
}

function noteVoiceN(noteEl: Element): string {
  return noteEl.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || '1';
}

function isChordNote(note: Element): boolean {
  return note.querySelector(':scope > chord, :scope > *|chord') != null;
}

function noteDurationN(note: Element): number {
  const d = note.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(d?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function timelineDurationEl(el: Element): number {
  const d = el.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(d?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

type StaffTimedNote = { note: Element; time: number; voice: string; end: number };

function staffTimedNotesInMeasure(measure: Element, staffN: number): StaffTimedNote[] {
  const children = [...measure.children];
  const voiceCursor = new Map<string, number>();
  let lastNoteVoice = '1';
  const out: StaffTimedNote[] = [];
  const nextNoteVoice = (fromIdx: number): string => {
    for (let j = fromIdx + 1; j < children.length; j += 1) {
      const c = children[j]!;
      if (xmlLocalName(c) !== 'note') continue;
      if (isChordNote(c)) continue;
      if (noteStaffN(c) !== staffN) continue;
      return noteVoiceN(c);
    }
    return lastNoteVoice;
  };
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]!;
    const tag = xmlLocalName(child);
    if (tag === 'backup') {
      const v =
        child.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || lastNoteVoice;
      const dur = timelineDurationEl(child);
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - dur));
    } else if (tag === 'forward') {
      const explicit = child.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
      let v = explicit || nextNoteVoice(i);
      const dur = timelineDurationEl(child);
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + dur);
    } else if (tag === 'note') {
      if (noteStaffN(child) !== staffN) continue;
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

function staffVoicesOverlap(timed: StaffTimedNote[]): boolean {
  const byVoice = new Map<string, Array<{ start: number; end: number }>>();
  for (const { voice, time, end } of timed) {
    const list = byVoice.get(voice) ?? [];
    list.push({ start: time, end });
    byVoice.set(voice, list);
  }
  const voices = [...byVoice.keys()];
  for (let i = 0; i < voices.length; i += 1) {
    for (let j = i + 1; j < voices.length; j += 1) {
      for (const a of byVoice.get(voices[i]!)!) {
        for (const b of byVoice.get(voices[j]!)!) {
          if (Math.max(a.start, b.start) < Math.min(a.end, b.end)) return true;
        }
      }
    }
  }
  return false;
}

function spreadOverlappingTimedNotes(timed: StaffTimedNote[]): StaffTimedNote[] {
  const sorted = [...timed].sort(
    (a, b) => a.time - b.time || Number(a.voice) - Number(b.voice) || 0,
  );
  let cursor = 0;
  const out: StaffTimedNote[] = [];
  for (const entry of sorted) {
    const dur = entry.end - entry.time;
    let place = entry.time;
    if (place < cursor) place = cursor;
    const end = isChordNote(entry.note) ? place : place + Math.max(dur, noteDurationN(entry.note));
    out.push({ ...entry, time: place, end });
    if (!isChordNote(entry.note)) cursor = end;
  }
  return out;
}

/**
 * 한 staff — multi-voice를 단일 timeline에 순차 배치(겹침 허용). voice 태그는 유지.
 * @returns 변경 여부
 */
export function sequentializeStaffVoicesForOsmdPreview(measure: Element, staffN: number): boolean {
  const timed = staffTimedNotesInMeasure(measure, staffN);
  if (timed.length < 2) return false;
  const voices = new Set(timed.map((x) => x.voice));
  if (voices.size < 2) return false;
  if (!staffVoicesOverlap(timed)) return false;

  const placed = spreadOverlappingTimedNotes(timed);
  const doc = measure.ownerDocument!;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const mk = (local: string) => (ns ? doc.createElementNS(ns, local) : doc.createElement(local));

  const toRemove = [...measure.children].filter((c) => {
    const tag = xmlLocalName(c);
    if (tag === 'backup' || tag === 'forward') return true;
    if (tag !== 'note') return false;
    return noteStaffN(c) === staffN;
  });
  for (const el of toRemove) measure.removeChild(el);

  let insertAt = measureHeaderInsertIndex(measure);
  let cursor = 0;
  let po = 0;
  for (const { note, time, voice } of placed) {
    if (time > cursor) {
      const fwd = mk('forward');
      const durEl = mk('duration');
      durEl.textContent = String(time - cursor);
      fwd.appendChild(durEl);
      measure.insertBefore(fwd, measure.children[insertAt] ?? null);
      insertAt += 1;
      cursor = time;
    }
    const clone = note.cloneNode(true) as Element;
    clone.setAttribute(HITL_SEQ_PREVIEW_ATTR, voice);
    if (!isChordNote(clone)) {
      po += 1;
      clone.setAttribute(HITL_PLAY_ORDER_ATTR, String(po));
    }
    measure.insertBefore(clone, measure.children[insertAt] ?? null);
    insertAt += 1;
    if (!isChordNote(clone)) cursor = time + noteDurationN(clone);
  }

  snapshotNoteDefaultXForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
  return true;
}

export function measureMatchesVoiceSequentialTarget(
  partId: string,
  measureMxl: string,
  staffN: number,
  targets: ReadonlyArray<VoiceSequentialPreviewTarget>,
): boolean {
  for (const t of targets) {
    if (!hitlPreviewPartIdsMatch(t.partId, partId)) continue;
    if (String(t.measureMxl) !== measureMxl) continue;
    if (t.staffWithinPart != null && t.staffWithinPart > 0 && t.staffWithinPart !== staffN) continue;
    return true;
  }
  return false;
}

export function applyVoiceSequentialPreviewToXml(
  xml: string,
  targets: ReadonlyArray<VoiceSequentialPreviewTarget>,
): string {
  if (!targets.length || !xml.trim()) return xml;
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    let changed = false;
    for (const part of findXmlParts(doc)) {
      const partId = part.getAttribute('id')?.trim() || '';
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;
        const measureMxl = meas.getAttribute('number')?.trim() || '';
        for (const staffN of [1, 2]) {
          if (!measureMatchesVoiceSequentialTarget(partId, measureMxl, staffN, targets)) continue;
          if (sequentializeStaffVoicesForOsmdPreview(meas, staffN)) changed = true;
        }
      }
    }
    return changed ? serializeMusicXmlDocument(doc) : xml;
  } catch {
    return xml;
  }
}
