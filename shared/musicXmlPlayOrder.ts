/**
 * HITL 연주순번(가사순번) — 미리보기 배치·OSMD 정렬의 단일 기준.
 * 같은 순번 = 동시 시작 column. 저장 MXL voice·duration·빔은 불변.
 *
 * 미리보기 x: 마디 공통 — 순번 1(또는 최소 순번) = 32, 마디 끝 = 432, 박자표 길이로 N등분.
 * 각 음표 onset(박자 단위) = 순번 column + 빔 후속 누적 duration.
 */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
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

function findBeamStartLeader(leaders: Element[], leader: Element): Element | null {
  if (!hasBeam(leader)) return null;
  if (isBeamBegin(leader)) return leader;
  const idx = leaders.indexOf(leader);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i -= 1) {
    const prev = leaders[i]!;
    if (noteVoiceNumber(prev) !== noteVoiceNumber(leader)) break;
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

function snapExplicitPlayOrderColumns(layout: Map<Element, number>, leaders: Element[]): void {
  const byPo = new Map<number, Element[]>();
  for (const leader of leaders) {
    const po = readPlayOrder(leader);
    if (po == null) continue;
    const list = byPo.get(po) ?? [];
    list.push(leader);
    byPo.set(po, list);
  }
  for (const group of byPo.values()) {
    if (group.length < 2) continue;
    const minLayout = Math.min(...group.map((l) => layout.get(l) ?? 0));
    for (const leader of group) layout.set(leader, minLayout);
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

/** 마디 공통 grid — 순번·박자 → default-x (성부별 동일 onset = 동일 x). */
export function applyPlayOrderLayoutToMeasure(measure: Element): void {
  const staves = new Set<number>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note') staves.add(noteStaffNumber(child));
  }
  const layoutLen = measureLengthUnits(measure);
  const defaults = buildMeasureDefaultPlayOrders(measure, staves);
  const allLeaders = allLeadersInMeasure(measure);
  const poOnset = buildPlayOrderOnsetMap(allLeaders, defaults);

  const layout = new Map<Element, number>();
  for (const leader of allLeaders) {
    const staffLeaders = noteLeadersOnStaff(measure, noteStaffNumber(leader));
    const beamStart = findBeamStartLeader(staffLeaders, leader);
    if (beamStart && beamStart !== leader) continue;
    const po = effectivePlayOrder(leader, defaults);
    layout.set(leader, poOnset.get(po) ?? 0);
  }

  snapExplicitPlayOrderColumns(layout, allLeaders);

  for (const staffN of staves) {
    const staffLeaders = noteLeadersOnStaff(measure, staffN);
    for (const leader of staffLeaders) {
      const beamStart = findBeamStartLeader(staffLeaders, leader);
      if (!beamStart || beamStart === leader) continue;
      layout.set(leader, layoutOnsetFromBeamStart(staffLeaders, leader, beamStart, layout));
    }
  }

  for (const leader of allLeaders) {
    setLayoutAttrsOnGroup(measure, leader, layout.get(leader) ?? 0, layoutLen, readPlayOrder(leader));
  }
}

/** OSMD 미리보기 — 같은 명시 연주순번 leader를 동일 voice로(OSMD column 분리 완화). */
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
