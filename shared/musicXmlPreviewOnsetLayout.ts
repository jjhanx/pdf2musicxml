/**
 * OSMD/HITL 미리보기 전용 — 마디·staff별 onset column(가사 syllable column)과 default-x 배치.
 * 저장 MXL voice·빔·duration은 불변; preview XML attribute만 추가.
 */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
import { applyPlayOrderLayoutToMeasure } from './musicXmlPlayOrder';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function findXmlParts(doc: Document): Element[] {
  const out: Element[] = [];
  const root = doc.documentElement;
  if (!root) return out;
  if (xmlLocalName(root) === 'part') out.push(root);
  for (const el of [...root.children]) {
    if (xmlLocalName(el) === 'part') out.push(el);
  }
  return out;
}

export const OSMD_ONSET_UNITS_ATTR = 'data-osmd-onset-units';
export const OSMD_ONSET_SLOT_ATTR = 'data-osmd-onset-slot';
export const OSMD_LYRIC_SLOT_ATTR = 'data-osmd-lyric-slot';
/** SVG align 전용 column x — OSMD load XML에는 default-x를 두지 않음(0폭·skip 방지). */
export const OSMD_LAYOUT_X_ATTR = 'data-osmd-layout-x';

const PREVIEW_LAYOUT_BASE_X = 32;
const PREVIEW_LAYOUT_SPAN = 400;

function timelineVoiceEl(el: Element, fallbackVoice: string): string {
  const v = el.querySelector(':scope > voice, :scope > *|voice');
  const text = v?.textContent?.trim();
  return text || fallbackVoice;
}

function timelineDurationEl(el: Element): number {
  const durEl = el.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(durEl?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function noteStaffNumber(note: Element): number {
  const st = note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim();
  return st && /^\d+$/.test(st) ? parseInt(st, 10) : 1;
}

function noteVoiceNumber(note: Element): string {
  const v = note.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
  return v || '1';
}

function noteDurationValue(note: Element): number {
  const durEl = note.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(durEl?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function isRestNote(note: Element): boolean {
  return note.querySelector(':scope > rest, :scope > *|rest') !== null;
}

function isGraceNote(note: Element): boolean {
  return note.querySelector(':scope > grace, :scope > *|grace') !== null;
}

function isChordMember(note: Element): boolean {
  return note.querySelector(':scope > chord, :scope > *|chord') !== null;
}

export function measureLengthUnits(measure: Element): number {
  let divisions = 0;
  let beats = 4;
  let beatType = 4;
  for (const attr of [...measure.children]) {
    if (xmlLocalName(attr) !== 'attributes') continue;
    const divEl = attr.querySelector('divisions, *|divisions');
    if (divEl?.textContent?.trim() && /^\d+$/.test(divEl.textContent.trim())) {
      divisions = Math.max(1, parseInt(divEl.textContent.trim(), 10));
    }
    const timeEl = attr.querySelector('time, *|time');
    if (timeEl) {
      const bEl = timeEl.querySelector('beats, *|beats');
      const btEl = timeEl.querySelector('beat-type, *|beat-type');
      if (bEl?.textContent?.trim() && /^\d+$/.test(bEl.textContent.trim())) {
        beats = Math.max(1, parseInt(bEl.textContent.trim(), 10));
      }
      if (btEl?.textContent?.trim() && /^\d+$/.test(btEl.textContent.trim())) {
        beatType = Math.max(1, parseInt(btEl.textContent.trim(), 10));
      }
    }
  }
  const timelineEnd = measureTimelineEndUnits(measure);
  // mid-score 마디·PR/PL prune 후 <divisions> 없음 → 기본 1이면 뒤 음이 432에 뭉쳐 소실·간격 왜곡
  if (divisions <= 0) return Math.max(1, timelineEnd);
  const fromTime = Math.max(1, Math.round((divisions * beats * 4) / beatType));
  return Math.max(fromTime, timelineEnd);
}

/** 미리보기 default-x 분모 — 박자표 길이와 실제 timeline 끝 중 큰 값. */
export function previewLayoutLengthUnits(measure: Element): number {
  return measureLengthUnits(measure);
}

function noteGroupWithChords(measure: Element, leader: Element): Element[] {
  const group: Element[] = [leader];
  const siblings = [...measure.children];
  const start = siblings.indexOf(leader);
  if (start < 0) return group;
  for (let j = start + 1; j < siblings.length; j += 1) {
    const next = siblings[j]!;
    if (xmlLocalName(next) !== 'note') break;
    if (!isChordMember(next)) break;
    group.push(next);
  }
  return group;
}

/** voice timeline — note leader → onset(divisions). MusicXML backup/forward = 단일 part cursor. */
export function collectStaffNoteOnsets(measure: Element, staffN?: number): Map<Element, number> {
  const out = new Map<Element, number>();
  let cursor = 0;
  for (const el of [...measure.children]) {
    const tag = xmlLocalName(el);
    if (tag === 'backup') {
      cursor = Math.max(0, cursor - timelineDurationEl(el));
    } else if (tag === 'forward') {
      cursor += timelineDurationEl(el);
    } else if (tag === 'note') {
      if (isChordMember(el)) continue;
      if (staffN != null && noteStaffNumber(el) !== staffN) continue;
      out.set(el, cursor);
      cursor += noteDurationValue(el);
    }
  }
  return out;
}

export function measureTimelineEndUnits(measure: Element, staffN?: number): number {
  const voiceCursor = new Map<string, number>();
  let lastNoteVoice = '1';
  let maxEnd = 0;
  for (const el of [...measure.children]) {
    const tag = xmlLocalName(el);
    if (tag === 'backup') {
      const v = timelineVoiceEl(el, lastNoteVoice);
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - timelineDurationEl(el)));
      for (const end of voiceCursor.values()) maxEnd = Math.max(maxEnd, end);
    } else if (tag === 'forward') {
      const v = timelineVoiceEl(el, lastNoteVoice);
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + timelineDurationEl(el));
      for (const end of voiceCursor.values()) maxEnd = Math.max(maxEnd, end);
    } else if (tag === 'note') {
      if (isChordMember(el)) continue;
      if (staffN != null && noteStaffNumber(el) !== staffN) continue;
      const voice = noteVoiceNumber(el);
      lastNoteVoice = voice;
      const start = voiceCursor.get(voice) ?? 0;
      const end = start + noteDurationValue(el);
      voiceCursor.set(voice, end);
      maxEnd = Math.max(maxEnd, end);
    }
  }
  return Math.max(1, maxEnd);
}

/** 미리보기 default-x — onset ÷ layoutLen × span (tenths). */
export function defaultXFromOnset(onset: number, measureLen: number): string {
  const len = Math.max(1, measureLen);
  const clamped = Math.max(0, Math.min(onset, len));
  return (PREVIEW_LAYOUT_BASE_X + (clamped / len) * PREVIEW_LAYOUT_SPAN).toFixed(2);
}

function setPreviewAttrsOnGroup(
  measure: Element,
  leader: Element,
  onset: number,
  onsetSlot: number,
  measureLen: number,
): void {
  const x = defaultXFromOnset(onset, measureLen);
  for (const note of noteGroupWithChords(measure, leader)) {
    note.setAttribute(OSMD_ONSET_UNITS_ATTR, String(onset));
    note.setAttribute(OSMD_ONSET_SLOT_ATTR, String(onsetSlot));
    note.setAttribute(OSMD_LAYOUT_X_ATTR, x);
    note.setAttribute('default-x', x);
  }
}

/**
 * staff별 unique onset → column slot(0..) 부여 후 default-x 재주입.
 * 동시 onset(다 voice·다른 박자)은 같은 column·같은 x.
 */
export function applyPreviewOnsetSlotLayoutToMeasure(measure: Element): void {
  applyPlayOrderLayoutToMeasure(measure);
  assignPreviewLyricSlotsToMeasure(measure);
}

/**
 * inject_ocr.list_attachable_notes_in_measure 와 동일 규칙 — 마디 내 가사 부착 순번(0-based).
 */
export function assignPreviewLyricSlotsToMeasure(measure: Element, staffN?: number): void {
  let slot = 0;
  let lastIncludedVoice: string | null = null;
  for (const note of [...measure.children]) {
    if (xmlLocalName(note) !== 'note') continue;
    if (staffN != null && noteStaffNumber(note) !== staffN) continue;
    note.removeAttribute(OSMD_LYRIC_SLOT_ATTR);
    if (isRestNote(note) || isGraceNote(note)) continue;
    const voice = noteVoiceNumber(note);
    if (isChordMember(note)) {
      if (lastIncludedVoice !== null && voice === lastIncludedVoice) continue;
    }
    note.setAttribute(OSMD_LYRIC_SLOT_ATTR, String(slot));
    slot += 1;
    lastIncludedVoice = voice;
  }
}

export function applyPreviewOnsetSlotLayoutToXml(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        applyPreviewOnsetSlotLayoutToMeasure(measure);
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

export function readPreviewOnsetUnits(note: Element): number | null {
  const raw = note.getAttribute(OSMD_ONSET_UNITS_ATTR)?.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function readPreviewOnsetSlot(note: Element): number | null {
  const raw = note.getAttribute(OSMD_ONSET_SLOT_ATTR)?.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function readPreviewLyricSlot(note: Element): number | null {
  const raw = note.getAttribute(OSMD_LYRIC_SLOT_ATTR)?.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
