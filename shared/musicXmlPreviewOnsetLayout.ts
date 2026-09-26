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

export const PREVIEW_LAYOUT_BASE_X = 32;
export const PREVIEW_LAYOUT_SPAN = 400;

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
  // overfull timeline으로 분모를 키우면 default-x가 박자칸 밖으로 나가 다음 마디로 침범해 보임
  return fromTime;
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
export function defaultXFromOnset(onset: number, measureLen: number, layoutSpan?: number): string {
  const len = Math.max(1, measureLen);
  const clamped = Math.max(0, Math.min(onset, len));
  const span = layoutSpan != null && Number.isFinite(layoutSpan) && layoutSpan > 0
    ? layoutSpan
    : PREVIEW_LAYOUT_SPAN;
  return (PREVIEW_LAYOUT_BASE_X + (clamped / len) * span).toFixed(2);
}

function noteHasAccidentalOrAlter(note: Element): boolean {
  if (note.querySelector(':scope > accidental, :scope > *|accidental')) return true;
  const alterEl = note.querySelector(':scope > pitch > alter, :scope > *|pitch > *|alter');
  const alt = alterEl?.textContent?.trim();
  if (alt && alt !== '0') return true;
  return false;
}

export const OSMD_MEASURE_LAYOUT_SPAN_ATTR = 'data-osmd-layout-span';

/**
 * 마디 내 음표들에 그려지는 시각적 요소(꾸밈음, 임시표, 점 등)를 고려한 최소 필요 layout span(tenths).
 * 꾸밈음을 달고 있는 음표의 폭(꾸밈음 + # + 본음)을 기준으로 단위 박자 비율을 계산하고,
 * 그 마디의 다른 음표들도 그 기준에 비례하도록 마디 span을 확장한다.
 */
export function measureRequiredVisualSpan(
  measure: Element,
  baseSpan = PREVIEW_LAYOUT_SPAN,
): number {
  const len = Math.max(1, previewLayoutLengthUnits(measure));
  const attrSpan = parseFloat(measure.getAttribute(OSMD_MEASURE_LAYOUT_SPAN_ATTR) || '');
  const minBase = Number.isFinite(attrSpan) && attrSpan > baseSpan ? attrSpan : baseSpan;
  const baseRate = minBase / len;
  let maxRate = baseRate;

  const children = [...measure.children];
  let currentGraceGroup: Element[] = [];

  for (const child of children) {
    if (xmlLocalName(child) !== 'note') {
      if (xmlLocalName(child) === 'backup') {
        currentGraceGroup = [];
      }
      continue;
    }
    if (isChordMember(child)) continue;

    if (isGraceNote(child)) {
      currentGraceGroup.push(child);
      continue;
    }

    const dur = noteDurationValue(child);
    const hasGrace = currentGraceGroup.length > 0;
    // 꾸밈음이 본음 앞에 달려있는 경우에만, 본음의 박자(dur) 대비 필요한 시각적 폭을 산출하여 마디 span을 확장
    // (일반 임시표를 가진 일반 음표는 기본 박자 배치를 유지해야 하므로 대상에서 제외)
    if (dur > 0 && hasGrace) {
      let neededWidth = 30; // 기본 본음 머리 폭
      if (noteHasAccidentalOrAlter(child)) neededWidth += 14;
      if (child.querySelector(':scope > dot, :scope > *|dot')) neededWidth += 8;

      for (const g of currentGraceGroup) {
        neededWidth += 16; // 꾸밈음 머리 + 기둥
        if (noteHasAccidentalOrAlter(g)) {
          neededWidth += 18; // 꾸밈음 앞의 #, b 등 임시표
        }
      }
      neededWidth += 12; // 꾸밈음/임시표와 앞선 본음 사이 안전 간격

      const rate = neededWidth / dur;
      if (rate > maxRate) {
        maxRate = rate;
      }
    }

    currentGraceGroup = [];
  }

  return Math.max(minBase, Math.round(len * maxRate));
}

/**
 * 악보 전체에서 동일 마디 번호의 모든 성부(Part/Staff)를 조사하여,
 * 가장 큰 필요 layout span으로 마디 길이를 통일하는 맵(measureNumber -> unifiedSpan) 반환.
 * 각 measure 엘리먼트에도 `data-osmd-layout-span` 속성을 설정하여,
 * 이후 성부/스태프 필터링 후에도 통일된 마디 길이가 보존되도록 한다.
 */
export function buildScoreMeasureLayoutSpans(
  docOrRoot: Element | Document,
  baseSpan = PREVIEW_LAYOUT_SPAN,
): Map<number, number> {
  const spanByMeasure = new Map<number, number>();
  const parts = findXmlParts(docOrRoot as Document);
  for (const part of parts) {
    for (const measure of [...part.children]) {
      if (xmlLocalName(measure) !== 'measure') continue;
      const num = parseInt(measure.getAttribute('number') ?? '0', 10);
      if (!Number.isFinite(num) || num <= 0) continue;
      const span = measureRequiredVisualSpan(measure, baseSpan);
      const prev = spanByMeasure.get(num) ?? baseSpan;
      if (span > prev) {
        spanByMeasure.set(num, span);
      }
    }
  }

  // 모든 성부의 해당 마디에 통일된 span 속성 기록 (필터링 후에도 전 성부 길이 일치 보존)
  for (const part of parts) {
    for (const measure of [...part.children]) {
      if (xmlLocalName(measure) !== 'measure') continue;
      const num = parseInt(measure.getAttribute('number') ?? '0', 10);
      if (!Number.isFinite(num) || num <= 0) continue;
      const unified = spanByMeasure.get(num);
      if (unified != null && unified > baseSpan) {
        measure.setAttribute(OSMD_MEASURE_LAYOUT_SPAN_ATTR, String(unified));
      }
    }
  }

  return spanByMeasure;
}

function setPreviewAttrsOnGroup(
  measure: Element,
  leader: Element,
  onset: number,
  onsetSlot: number,
  measureLen: number,
  layoutSpan?: number,
): void {
  const x = defaultXFromOnset(onset, measureLen, layoutSpan);
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
export function applyPreviewOnsetSlotLayoutToMeasure(measure: Element, layoutSpan?: number): void {
  applyPlayOrderLayoutToMeasure(measure, layoutSpan);
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
    const spanMap = buildScoreMeasureLayoutSpans(doc);
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        const num = parseInt(measure.getAttribute('number') ?? '0', 10);
        const span = Number.isFinite(num) && num > 0 ? spanMap.get(num) : undefined;
        applyPreviewOnsetSlotLayoutToMeasure(measure, span);
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
