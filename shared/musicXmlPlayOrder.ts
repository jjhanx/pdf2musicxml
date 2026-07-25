/**
 * HITL 연주순번(가사순번) — 미리보기 배치·OSMD 정렬의 단일 기준.
 * 같은 순번 = 동시 시작 column. 저장 MXL voice·duration·빔은 불변.
 */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
import {
  collectStaffNoteOnsets,
  measureLengthUnits,
  measureTimelineEndUnits,
  defaultXFromOnset,
  OSMD_ONSET_UNITS_ATTR,
} from './musicXmlPreviewOnsetLayout';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

export const HITL_PLAY_ORDER_ATTR = 'data-hitl-play-order';

const PREVIEW_LAYOUT_BASE_X = 32;
const PREVIEW_LAYOUT_SPAN = 400;

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

function noteStaffNumber(note: Element): number {
  const st = note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim();
  return st && /^\d+$/.test(st) ? parseInt(st, 10) : 1;
}

function noteVoiceNumber(note: Element): string {
  const v = note.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
  return v || '1';
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

export function xmlPitchLabel(note: Element): string {
  const step = note.querySelector('step, *|step')?.textContent?.trim() ?? '';
  const alter = note.querySelector('alter, *|alter')?.textContent?.trim();
  const oct = note.querySelector('octave, *|octave')?.textContent?.trim() ?? '';
  const acc = alter === '-1' ? 'b' : alter === '1' ? '#' : '';
  return `${step}${acc}${oct}`;
}

export function readPlayOrder(note: Element): number | null {
  const raw = note.getAttribute(HITL_PLAY_ORDER_ATTR)?.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** staff 문서 순서 → 기본 연주순번(1-based). voice timeline과 무관 — 마디 편집 #index 순서. */
export function defaultPlayOrdersFromDocumentOrder(measure: Element, staffN?: number): Map<Element, number> {
  const out = new Map<Element, number>();
  let order = 0;
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (isChordMember(child)) continue;
    if (staffN != null && noteStaffNumber(child) !== staffN) continue;
    order += 1;
    out.set(child, order);
  }
  return out;
}

/** @deprecated HITL UI·미리보기는 document order 사용. voice timeline은 OMR 내부용. */
export function defaultPlayOrdersFromTimeline(measure: Element, staffN?: number): Map<Element, number> {
  return defaultPlayOrdersFromDocumentOrder(measure, staffN);
}

export function effectivePlayOrder(
  leader: Element,
  defaults: Map<Element, number>,
): number {
  return readPlayOrder(leader) ?? defaults.get(leader) ?? 1;
}

function setLayoutAttrsOnGroup(
  measure: Element,
  leader: Element,
  layoutOnset: number,
  layoutLen: number,
  playOrder: number | null,
): void {
  const x = defaultXFromOnset(layoutOnset, layoutLen);
  for (const note of noteGroupWithChords(measure, leader)) {
    if (playOrder != null) note.setAttribute(HITL_PLAY_ORDER_ATTR, String(playOrder));
    note.setAttribute(OSMD_ONSET_UNITS_ATTR, String(layoutOnset));
    note.setAttribute('default-x', x);
  }
}

function noteDurationValue(note: Element): number {
  const durEl = note.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(durEl?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function layoutOnsetsForStaff(
  leaders: Element[],
  onsets: Map<Element, number>,
  explicitGroupMinOnset: Map<number, number>,
): Map<Element, number> {
  const layoutOnset = new Map<Element, number>();
  for (const leader of leaders) {
    const po = readPlayOrder(leader);
    if (po == null) continue;
    const raw = onsets.get(leader) ?? 0;
    layoutOnset.set(leader, explicitGroupMinOnset.get(po) ?? raw);
  }
  const voices = [...new Set(leaders.map((l) => noteVoiceNumber(l)))].sort(
    (a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99),
  );
  for (const voice of voices) {
    let prevLeader: Element | null = null;
    for (const leader of leaders) {
      if (noteVoiceNumber(leader) !== voice) continue;
      if (layoutOnset.has(leader)) {
        prevLeader = leader;
        continue;
      }
      const raw = onsets.get(leader) ?? 0;
      if (prevLeader == null) {
        layoutOnset.set(leader, raw);
      } else {
        const prevRaw = onsets.get(prevLeader) ?? 0;
        const prevLayout = layoutOnset.get(prevLeader) ?? prevRaw;
        layoutOnset.set(leader, prevLayout + (raw - prevRaw));
      }
      prevLeader = leader;
    }
  }
  return layoutOnset;
}

/** staff별 default-x — voice onset 비례 + 명시 연주순번은 그룹 min onset column + voice 내 상대 간격 유지. */
export function applyPlayOrderLayoutToMeasure(measure: Element): void {
  const staves = new Set<number>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note') staves.add(noteStaffNumber(child));
  }
  const nominalLen = measureLengthUnits(measure);

  for (const staffN of staves) {
    const onsets = collectStaffNoteOnsets(measure, staffN);
    const leaders = noteLeadersOnStaff(measure, staffN);

    const explicitGroupMinOnset = new Map<number, number>();
    for (const leader of leaders) {
      const po = readPlayOrder(leader);
      if (po == null) continue;
      const onset = onsets.get(leader) ?? 0;
      const prev = explicitGroupMinOnset.get(po);
      explicitGroupMinOnset.set(po, prev == null ? onset : Math.min(prev, onset));
    }

    const layoutOnset = layoutOnsetsForStaff(leaders, onsets, explicitGroupMinOnset);
    let layoutLen = Math.max(nominalLen, measureTimelineEndUnits(measure, staffN));
    for (const leader of leaders) {
      const lo = layoutOnset.get(leader) ?? onsets.get(leader) ?? 0;
      layoutLen = Math.max(layoutLen, lo + noteDurationValue(leader));
    }

    for (const leader of leaders) {
      const po = readPlayOrder(leader);
      const layoutPos = layoutOnset.get(leader) ?? onsets.get(leader) ?? 0;
      setLayoutAttrsOnGroup(measure, leader, layoutPos, layoutLen, po);
    }
  }
}

function noteLeadersOnStaff(measure: Element, staffN: number): Element[] {
  const out: Element[] = [];
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (isChordMember(child)) continue;
    if (noteStaffNumber(child) !== staffN) continue;
    out.push(child);
  }
  return out;
}

/** 같은 명시 연주순번·같은 pitch OMR duplicate leader 제거(가장 이른 onset 1개만 유지). */
function dedupePlayOrderPitchDuplicates(measure: Element, staffN: number, leaders: Element[]): boolean {
  let onsets = collectStaffNoteOnsets(measure, staffN);
  const sorted = [...leaders].sort(
    (a, b) => (onsets.get(a) ?? 0) - (onsets.get(b) ?? 0) || [...measure.children].indexOf(a) - [...measure.children].indexOf(b),
  );
  const keeperByPitch = new Map<string, Element>();
  let changed = false;
  for (const leader of sorted) {
    const pitch = xmlPitchLabel(leader);
    if (!keeperByPitch.has(pitch)) {
      keeperByPitch.set(pitch, leader);
      continue;
    }
    for (const n of noteGroupWithChords(measure, leader)) {
      if (n.parentNode === measure) measure.removeChild(n);
    }
    changed = true;
    onsets = collectStaffNoteOnsets(measure, staffN);
  }
  return changed;
}

/** coalesce 후 명시 연주순번 없는 동일 pitch 잔여층 제거(OMR duplicate). */
function removeOrphanDuplicatePitchLayers(measure: Element, staffN: number): void {
  const primaryPitch = new Set<string>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (noteStaffNumber(child) !== staffN) continue;
    if (isChordMember(child)) continue;
    if (readPlayOrder(child) != null) primaryPitch.add(xmlPitchLabel(child));
  }
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (noteStaffNumber(child) !== staffN) continue;
    if (readPlayOrder(child) != null) continue;
    if (!primaryPitch.has(xmlPitchLabel(child))) continue;
    if (isChordMember(child)) {
      child.remove();
      continue;
    }
    for (const n of noteGroupWithChords(measure, child)) {
      if (n.parentNode === measure) measure.removeChild(n);
    }
  }
}

/**
 * OSMD 미리보기 — 같은 명시 연주순번의 **동일 pitch** OMR duplicate만 제거.
 * 박자·pitch가 다른 음(F4 4분 + E5 8분 등)은 chord/onset 병합하지 않음 → render 후 SVG column 정렬.
 */
export function dedupeSamePlayOrderPitchLayersForOsmdPreview(measure: Element): boolean {
  const staves = new Set<number>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note') staves.add(noteStaffNumber(child));
  }
  let changed = false;
  for (const staffN of staves) {
    const byOrder = new Map<number, Element[]>();
    for (const leader of noteLeadersOnStaff(measure, staffN)) {
      const po = readPlayOrder(leader);
      if (po == null) continue;
      const list = byOrder.get(po) ?? [];
      list.push(leader);
      byOrder.set(po, list);
    }
    let staffChanged = false;
    for (const group of byOrder.values()) {
      if (group.length < 2) continue;
      staffChanged = dedupePlayOrderPitchDuplicates(measure, staffN, group) || staffChanged;
    }
    if (staffChanged) removeOrphanDuplicatePitchLayers(measure, staffN);
    changed = staffChanged || changed;
  }
  return changed;
}

/** @deprecated dedupeSamePlayOrderPitchLayersForOsmdPreview — chord/onset 병합은 사용하지 않음 */
export function coalesceSamePlayOrderOnsetsForOsmdPreview(measure: Element): boolean {
  return dedupeSamePlayOrderPitchLayersForOsmdPreview(measure);
}

/** @deprecated dedupeSamePlayOrderPitchLayersForOsmdPreview */
export function alignOnsetsForSamePlayOrderPreview(measure: Element): boolean {
  return dedupeSamePlayOrderPitchLayersForOsmdPreview(measure);
}

/**
 * @deprecated voice·박자가 다른 연주순번 음을 한 voice로 합치면 timeline·빔이 깨짐. 미리보기에서 호출하지 않음.
 */
export function unifyVoiceForSamePlayOrderPreview(measure: Element): boolean {
  const staves = new Set<number>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note') staves.add(noteStaffNumber(child));
  }
  let changed = false;
  for (const staffN of staves) {
    const byOrder = new Map<number, Element[]>();
    for (const leader of noteLeadersOnStaff(measure, staffN)) {
      const po = readPlayOrder(leader);
      if (po == null) continue;
      const list = byOrder.get(po) ?? [];
      list.push(leader);
      byOrder.set(po, list);
    }
    for (const group of byOrder.values()) {
      if (group.length < 2) continue;
      const targetVoice = [...group.map((l) => noteVoiceNumber(l))].sort(
        (a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99),
      )[0]!;
      for (const leader of group) {
        for (const note of noteGroupWithChords(measure, leader)) {
          const vEl = note.querySelector(':scope > voice, :scope > *|voice');
          if (vEl && vEl.textContent?.trim() !== targetVoice) {
            vEl.textContent = targetVoice;
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

export function applyPlayOrderLayoutToXml(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        applyPlayOrderLayoutToMeasure(measure);
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

export type PlayOrderAlignMember = {
  pitch: string;
};

export type PlayOrderAlignGroup = {
  partId: string;
  measureNumber: number;
  staff: number;
  playOrder: number;
  members: PlayOrderAlignMember[];
};

/** OSMD render 후 pitch 매칭 — 같은 playOrder·2명 이상만. voice는 사용하지 않음. */
export function collectPlayOrderAlignGroupsFromXml(xml: string): PlayOrderAlignGroup[] {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return [];
    const out: PlayOrderAlignGroup[] = [];
    for (const part of findXmlParts(doc)) {
      const partId = part.getAttribute('id')?.trim() ?? '';
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        const measureNumber = parseInt(measure.getAttribute('number') ?? '0', 10);
        if (!Number.isFinite(measureNumber) || measureNumber <= 0) continue;

        const staves = new Set<number>();
        for (const child of [...measure.children]) {
          if (xmlLocalName(child) === 'note') staves.add(noteStaffNumber(child));
        }
        for (const staffN of staves) {
          const byOrder = new Map<number, PlayOrderAlignMember[]>();
          for (const leader of noteLeadersOnStaff(measure, staffN)) {
            if (isRestNote(leader) || isGraceNote(leader)) continue;
            const order = readPlayOrder(leader);
            if (order == null) continue;
            const list = byOrder.get(order) ?? [];
            list.push({ pitch: xmlPitchLabel(leader) });
            byOrder.set(order, list);
          }
          for (const [playOrder, members] of byOrder) {
            if (members.length < 2) continue;
            const uniqueMembers: PlayOrderAlignMember[] = [];
            const seenPitch = new Set<string>();
            for (const m of members) {
              if (seenPitch.has(m.pitch)) continue;
              seenPitch.add(m.pitch);
              uniqueMembers.push(m);
            }
            if (uniqueMembers.length < 2) continue;
            out.push({ partId, measureNumber, staff: staffN, playOrder, members: uniqueMembers });
          }
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function measureLengthUnitsExport(measure: Element): number {
  return measureLengthUnits(measure);
}
