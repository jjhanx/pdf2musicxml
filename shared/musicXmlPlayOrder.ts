/**
 * HITL 연주순번(가사순번) — 미리보기 배치·OSMD 정렬의 단일 기준.
 * 같은 순번 = 동시 시작 column. 저장 MXL voice·duration·빔은 불변.
 *
 * 미리보기 x: 마디 공통 grid(순번1=32 ~ 끝=432). voice·timeline은 건드리지 않음 — 표시는 SVG translate.
 */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
import { collectStaffNoteOnsets } from './musicXmlTimelineCleanup';
import {
  measureLengthUnits,
  defaultXFromOnset,
} from './musicXmlPreviewOnsetLayout';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

export const HITL_PLAY_ORDER_ATTR = 'data-hitl-play-order';

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

/** staff 문서 순서 → 기본 연주순번(1-based). */
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

/** @deprecated HITL UI·미리보기는 document order 사용. */
export function defaultPlayOrdersFromTimeline(measure: Element, staffN?: number): Map<Element, number> {
  return defaultPlayOrdersFromDocumentOrder(measure, staffN);
}

function buildMeasureDefaultPlayOrders(measure: Element, staves: Set<number>): Map<Element, number> {
  const out = new Map<Element, number>();
  for (const staffN of staves) {
    for (const [leader, po] of defaultPlayOrdersFromDocumentOrder(measure, staffN)) {
      out.set(leader, po);
    }
  }
  return out;
}

export function effectivePlayOrder(leader: Element, defaults: Map<Element, number>): number {
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
    note.setAttribute('default-x', x);
  }
}

function hasBeam(note: Element): boolean {
  return note.querySelector(':scope > beam, :scope > *|beam') !== null;
}

function isBeamBegin(note: Element): boolean {
  for (const b of [...note.querySelectorAll(':scope > beam, :scope > *|beam')]) {
    if (b.textContent?.trim() === 'begin') return true;
  }
  return false;
}

function findBeamStartLeader(leaders: Element[], leader: Element, ignoreVoice = false): Element | null {
  if (!hasBeam(leader)) return null;
  if (isBeamBegin(leader)) return leader;
  const idx = leaders.indexOf(leader);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i -= 1) {
    const prev = leaders[i]!;
    if (!ignoreVoice && noteVoiceNumber(prev) !== noteVoiceNumber(leader)) break;
    if (!hasBeam(prev)) break;
    if (isBeamBegin(prev)) return prev;
  }
  return null;
}

function noteDurationValue(note: Element): number {
  const durEl = note.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(durEl?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function layoutOnsetFromBeamStart(
  leaders: Element[],
  leader: Element,
  beamStart: Element,
  layout: Map<Element, number>,
): number {
  const bsIdx = leaders.indexOf(beamStart);
  const myIdx = leaders.indexOf(leader);
  let pos = layout.get(beamStart) ?? 0;
  for (let i = bsIdx + 1; i <= myIdx; i += 1) {
    pos += noteDurationValue(leaders[i]!);
  }
  return pos;
}

/** PO(prev)→PO(next) step: prev PO anchor 박자. next가 prev PO beam begin에서 이어지면 beam begin 박자만. */
function playOrderStepDuration(
  leaders: Element[],
  prevPo: number,
  nextPo: number,
  defaults: Map<Element, number>,
): number {
  const nextLeader = leaders.find((l) => effectivePlayOrder(l, defaults) === nextPo);
  if (nextLeader) {
    const staffLeaders = leaders.filter((l) => noteStaffNumber(l) === noteStaffNumber(nextLeader));
    const beamStart = findBeamStartLeader(staffLeaders, nextLeader);
    if (
      beamStart &&
      beamStart !== nextLeader &&
      effectivePlayOrder(beamStart, defaults) === prevPo
    ) {
      return noteDurationValue(beamStart);
    }
  }
  const prevLeaders = leaders.filter((l) => effectivePlayOrder(l, defaults) === prevPo);
  if (!prevLeaders.length) return 1;
  return Math.max(...prevLeaders.map(noteDurationValue));
}

/** 마디 전체 순번 → rhythmic onset(0..layoutLen). 순번 1 = 0, 이후 순번은 이전 anchor 박자만큼 누적. */
function buildPlayOrderOnsetMap(
  leaders: Element[],
  defaults: Map<Element, number>,
): Map<number, number> {
  const sortedPos = [...new Set(leaders.map((l) => effectivePlayOrder(l, defaults)))].sort((a, b) => a - b);
  const poOnset = new Map<number, number>();
  if (!sortedPos.length) return poOnset;

  const anchor = sortedPos.includes(1) ? 1 : sortedPos[0]!;
  poOnset.set(anchor, 0);

  for (let i = 0; i < sortedPos.length; i += 1) {
    const po = sortedPos[i]!;
    if (poOnset.has(po)) continue;
    const prevPo = sortedPos[i - 1]!;
    const step = playOrderStepDuration(leaders, prevPo, po, defaults);
    poOnset.set(po, (poOnset.get(prevPo) ?? 0) + step);
  }
  return poOnset;
}

/** true — 명시 순번이 2개 이상이면 같은 column으로 snap (같은 번호 = 동시 시작). */
function shouldSnapExplicitPlayOrderGroup(group: Element[]): boolean {
  return group.length >= 2;
}

/**
 * 명시 연주순번 column onset.
 * 다중 voice: voice별 min onset 중 max (병렬 join).
 * 단일 voice: 그룹 내 max onset (앞 음을 뒤 동시 column으로).
 */
function explicitPlayOrderMusicalColumnOnset(
  group: Element[],
  musicalOnsets: Map<Element, number>,
): number {
  const minByVoice = new Map<string, number>();
  for (const leader of group) {
    const v = noteVoiceNumber(leader);
    const t = musicalOnsets.get(leader) ?? 0;
    const cur = minByVoice.get(v);
    if (cur == null || t < cur) minByVoice.set(v, t);
  }
  if (minByVoice.size >= 2) {
    return Math.max(...minByVoice.values());
  }
  return Math.max(0, ...group.map((l) => musicalOnsets.get(l) ?? 0));
}

function snapExplicitPlayOrderColumns(
  layout: Map<Element, number>,
  leaders: Element[],
  musicalOnsets: Map<Element, number>,
): void {
  const byPo = new Map<number, Element[]>();
  for (const leader of leaders) {
    const po = readPlayOrder(leader);
    if (po == null) continue;
    const list = byPo.get(po) ?? [];
    list.push(leader);
    byPo.set(po, list);
  }
  for (const group of byPo.values()) {
    if (!shouldSnapExplicitPlayOrderGroup(group)) continue;
    const columnOnset = explicitPlayOrderMusicalColumnOnset(group, musicalOnsets);
    for (const leader of group) layout.set(leader, columnOnset);
  }
}

/** 명시 연주순번 — layout 재적용 후 default-x도 동일 column. */
function resyncDefaultXAfterPlayOrderSnap(
  measure: Element,
  layout: Map<Element, number>,
  layoutLen: number,
): void {
  for (const leader of allLeadersInMeasure(measure)) {
    setLayoutAttrsOnGroup(measure, leader, layout.get(leader) ?? 0, layoutLen, readPlayOrder(leader));
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

function allLeadersInMeasure(measure: Element): Element[] {
  const out: Element[] = [];
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (isChordMember(child)) continue;
    out.push(child);
  }
  return out;
}

/** 마디 공통 grid — musical onset + 명시 연주순번 column snap + beam (voice·timeline 불변). */
export function applyPlayOrderLayoutToMeasure(measure: Element): void {
  const staves = new Set<number>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note') staves.add(noteStaffNumber(child));
  }
  const layoutLen = measureLengthUnits(measure);
  const musicalOnsets = collectStaffNoteOnsets(measure);
  const allLeaders = allLeadersInMeasure(measure);

  const layout = new Map<Element, number>();
  for (const leader of allLeaders) {
    const staffLeaders = noteLeadersOnStaff(measure, noteStaffNumber(leader));
    const beamStart = findBeamStartLeader(staffLeaders, leader);
    if (beamStart && beamStart !== leader) continue;
    layout.set(leader, musicalOnsets.get(leader) ?? 0);
  }

  snapExplicitPlayOrderColumns(layout, allLeaders, musicalOnsets);

  for (const staffN of staves) {
    const staffLeaders = noteLeadersOnStaff(measure, staffN);
    for (const leader of staffLeaders) {
      const beamStart = findBeamStartLeader(staffLeaders, leader);
      if (!beamStart || beamStart === leader) continue;
      layout.set(leader, layoutOnsetFromBeamStart(staffLeaders, leader, beamStart, layout));
    }
  }

  resyncDefaultXAfterPlayOrderSnap(measure, layout, layoutLen);
}

export type PreviewNoteLayoutTarget = {
  partId: string;
  measureNumber: number;
  staff: number;
  voice: string;
  pitch: string;
  defaultXTenths: number;
  playOrder: number | null;
};

/** OSMD SVG 정렬용 — leader·화음 member 포함, 문서 순. */
export function collectPreviewNoteLayoutTargetsFromXml(xml: string): PreviewNoteLayoutTarget[] {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return [];
    const out: PreviewNoteLayoutTarget[] = [];
    for (const part of findXmlParts(doc)) {
      const partId = part.getAttribute('id')?.trim() ?? '';
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        const measureNumber = parseInt(measure.getAttribute('number') ?? '0', 10);
        if (!Number.isFinite(measureNumber) || measureNumber <= 0) continue;
        for (const leader of allLeadersInMeasure(measure)) {
          if (isRestNote(leader) || isGraceNote(leader)) continue;
          const rawX = leader.getAttribute('default-x')?.trim();
          if (!rawX) continue;
          const defaultXTenths = parseFloat(rawX);
          if (!Number.isFinite(defaultXTenths)) continue;
          const playOrder = readPlayOrder(leader);
          const voice = noteVoiceNumber(leader);
          for (const note of noteGroupWithChords(measure, leader)) {
            if (isRestNote(note) || isGraceNote(note)) continue;
            out.push({
              partId,
              measureNumber,
              staff: noteStaffNumber(note),
              voice,
              pitch: xmlPitchLabel(note),
              defaultXTenths,
              playOrder,
            });
          }
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** @deprecated voice·timeline 변경 없음 — no-op. */
export function unifyVoiceForSamePlayOrderPreview(_measure: Element): boolean {
  return false;
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

export type ExplicitPlayOrderColumn = {
  partId: string;
  measureNumber: number;
  playOrder: number;
  defaultXTenths: number;
  pitches: string[];
};

/** 명시 연주순번 column — part·마디·순번별 default-x·pitch(화음 member 포함). */
export function collectExplicitPlayOrderColumnsFromXml(xml: string): ExplicitPlayOrderColumn[] {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return [];
    const byKey = new Map<string, ExplicitPlayOrderColumn>();
    for (const part of findXmlParts(doc)) {
      const partId = part.getAttribute('id')?.trim() ?? '';
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        const measureNumber = parseInt(measure.getAttribute('number') ?? '0', 10);
        if (!Number.isFinite(measureNumber) || measureNumber <= 0) continue;
        for (const leader of allLeadersInMeasure(measure)) {
          if (isRestNote(leader) || isGraceNote(leader)) continue;
          const playOrder = readPlayOrder(leader);
          if (playOrder == null) continue;
          const rawX = leader.getAttribute('default-x')?.trim();
          if (!rawX) continue;
          const defaultXTenths = parseFloat(rawX);
          if (!Number.isFinite(defaultXTenths)) continue;
          const key = `${partId}|${measureNumber}|${playOrder}`;
          let col = byKey.get(key);
          if (!col) {
            col = { partId, measureNumber, playOrder, defaultXTenths, pitches: [] };
            byKey.set(key, col);
          } else {
            col.defaultXTenths = Math.min(col.defaultXTenths, defaultXTenths);
          }
          const pitchSet = new Set(col.pitches);
          for (const note of noteGroupWithChords(measure, leader)) {
            if (isRestNote(note) || isGraceNote(note)) continue;
            const p = xmlPitchLabel(note);
            if (!pitchSet.has(p)) {
              pitchSet.add(p);
              col.pitches.push(p);
            }
          }
        }
      }
    }
    return [...byKey.values()].filter((c) => c.pitches.length >= 1);
  } catch {
    return [];
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

/** OSMD render 후 pitch 매칭 — 같은 playOrder·2명 이상만. */
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
            for (const note of noteGroupWithChords(measure, leader)) {
              if (isRestNote(note) || isGraceNote(note)) continue;
              list.push({ pitch: xmlPitchLabel(note) });
            }
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
