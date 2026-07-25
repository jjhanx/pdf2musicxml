/**
 * HITL 연주순번(가사순번) — 미리보기 배치·OSMD 정렬의 단일 기준.
 * 같은 순번 = 동시 시작 column. 저장 MXL voice·duration·빔은 불변.
 */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
import { collectStaffNoteOnsets, measureLengthUnits } from './musicXmlPreviewOnsetLayout';

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

/** voice timeline onset → 기본 연주순번(1-based). 같은 onset = 같은 번호. */
export function defaultPlayOrdersFromTimeline(measure: Element, staffN?: number): Map<Element, number> {
  const onsets = collectStaffNoteOnsets(measure, staffN);
  const uniqueOnsets = [...new Set(onsets.values())].sort((a, b) => a - b);
  const onsetToOrder = new Map(uniqueOnsets.map((o, i) => [o, i + 1]));
  const out = new Map<Element, number>();
  for (const [leader, onset] of onsets) {
    out.set(leader, onsetToOrder.get(onset) ?? 1);
  }
  return out;
}

export function effectivePlayOrder(
  leader: Element,
  defaults: Map<Element, number>,
): number {
  return readPlayOrder(leader) ?? defaults.get(leader) ?? 1;
}

function defaultXFromColumn(columnIndex: number, columnCount: number): string {
  if (columnCount <= 1) return String(PREVIEW_LAYOUT_BASE_X);
  const span = columnCount > 1 ? PREVIEW_LAYOUT_SPAN : 0;
  return (PREVIEW_LAYOUT_BASE_X + (columnIndex / (columnCount - 1)) * span).toFixed(2);
}

function setPlayOrderAttrsOnGroup(
  measure: Element,
  leader: Element,
  playOrder: number,
  columnIndex: number,
  columnCount: number,
): void {
  const x = defaultXFromColumn(columnIndex, columnCount);
  for (const note of noteGroupWithChords(measure, leader)) {
    if (readPlayOrder(leader) != null) {
      note.setAttribute(HITL_PLAY_ORDER_ATTR, String(playOrder));
    }
    note.setAttribute('default-x', x);
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

/** staff별 연주순번 → column default-x. 명시 순번 우선, 없으면 timeline 기본값. */
export function applyPlayOrderLayoutToMeasure(measure: Element): void {
  const staves = new Set<number>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note') staves.add(noteStaffNumber(child));
  }

  for (const staffN of staves) {
    const defaults = defaultPlayOrdersFromTimeline(measure, staffN);
    const leaders = noteLeadersOnStaff(measure, staffN);
    const orders = leaders.map((l) => effectivePlayOrder(l, defaults));
    const uniqueOrders = [...new Set(orders)].sort((a, b) => a - b);
    const orderToColumn = new Map(uniqueOrders.map((o, i) => [o, i]));

    for (const leader of leaders) {
      const order = effectivePlayOrder(leader, defaults);
      const col = orderToColumn.get(order) ?? 0;
      setPlayOrderAttrsOnGroup(measure, leader, order, col, uniqueOrders.length);
    }
  }
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
  voice: string;
};

export type PlayOrderAlignGroup = {
  partId: string;
  measureNumber: number;
  staff: number;
  playOrder: number;
  members: PlayOrderAlignMember[];
};

/** OSMD render 후 pitch+voice 매칭용 — 같은 playOrder·2명 이상만. */
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
          const defaults = defaultPlayOrdersFromTimeline(measure, staffN);
          const byOrder = new Map<number, PlayOrderAlignMember[]>();
          for (const leader of noteLeadersOnStaff(measure, staffN)) {
            if (isRestNote(leader) || isGraceNote(leader)) continue;
            const order = effectivePlayOrder(leader, defaults);
            const list = byOrder.get(order) ?? [];
            list.push({ pitch: xmlPitchLabel(leader), voice: noteVoiceNumber(leader) });
            byOrder.set(order, list);
          }
          for (const [playOrder, members] of byOrder) {
            if (members.length < 2) continue;
            out.push({ partId, measureNumber, staff: staffN, playOrder, members });
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
