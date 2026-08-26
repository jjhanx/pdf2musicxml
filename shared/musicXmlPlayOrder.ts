/**
 * HITL 연주순번(가사순번) — 미리보기 배치·OSMD 정렬의 단일 기준.
 * 같은 순번 = 동시 시작 column. 저장 MXL voice·duration·빔은 불변.
 *
 * 미리보기 x: 마디 공통 grid(순번1=32 ~ 끝=432). voice·timeline은 건드리지 않음 — 표시는 SVG translate.
 */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
import { collectVoiceParallelNoteOnsets } from './musicXmlTimelineCleanup';
import { defaultXFromOnset, previewLayoutLengthUnits, OSMD_LAYOUT_X_ATTR } from './musicXmlPreviewOnsetLayout';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

export const HITL_PLAY_ORDER_ATTR = 'data-hitl-play-order';

/** 숫자 순번 또는 `voice-order`(예: 5-6 = voice5의 순번6 열에 맞춤). */
export type PlayOrderSpec =
  | { kind: 'order'; order: number }
  | { kind: 'ref'; voice: number; order: number };

const PLAY_ORDER_REF_RE = /^(\d+)\s*[-–]\s*(\d+)$/;

export function parsePlayOrderSpec(raw: string | null | undefined): PlayOrderSpec | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === '0') return null;
  const ref = PLAY_ORDER_REF_RE.exec(s);
  if (ref) {
    const voice = parseInt(ref[1]!, 10);
    const order = parseInt(ref[2]!, 10);
    if (voice >= 1 && order >= 1) return { kind: 'ref', voice, order };
    return null;
  }
  if (!/^\d+$/.test(s)) return null;
  const order = parseInt(s, 10);
  return Number.isFinite(order) && order > 0 ? { kind: 'order', order } : null;
}

export function formatPlayOrderSpec(spec: PlayOrderSpec): string {
  return spec.kind === 'ref' ? `${spec.voice}-${spec.order}` : String(spec.order);
}

export function readPlayOrderSpec(note: Element): PlayOrderSpec | null {
  return parsePlayOrderSpec(note.getAttribute(HITL_PLAY_ORDER_ATTR));
}

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

/** 숫자 연주순번만. `5-6` 같은 교차 voice 참조는 null. */
export function readPlayOrder(note: Element): number | null {
  const spec = readPlayOrderSpec(note);
  return spec?.kind === 'order' ? spec.order : null;
}

/** `5-6` → { voice: 5, order: 6 }. */
export function readPlayOrderRef(note: Element): { voice: number; order: number } | null {
  const spec = readPlayOrderSpec(note);
  return spec?.kind === 'ref' ? { voice: spec.voice, order: spec.order } : null;
}

/** staff 문서 순서 → 기본 연주순번(1-based). voice 블록 순이라 미리보기 column과 어긋날 수 있음. */
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

/**
 * staff musical onset(타임라인) → 기본 연주순번.
 * 같은 onset = 같은 순번(동시 column). 마디 편집 빈 칸·미리보기 기본값에 사용.
 */
export function defaultPlayOrdersFromTimeline(measure: Element, staffN?: number): Map<Element, number> {
  const onsets = collectVoiceParallelNoteOnsets(measure);
  const leaders: { el: Element; onset: number; isGrace: boolean; idx: number }[] = [];
  let idx = 0;
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (isChordMember(child)) continue;
    const currentIdx = idx++;
    if (staffN != null && noteStaffNumber(child) !== staffN) continue;
    const isGrace = isGraceNote(child);
    leaders.push({
      el: child,
      onset: onsets.get(child) ?? 0,
      isGrace,
      idx: currentIdx,
    });
  }
  leaders.sort((a, b) => a.onset - b.onset || (a.isGrace === b.isGrace ? 0 : a.isGrace ? -1 : 1) || a.idx - b.idx);
  const out = new Map<Element, number>();
  let order = 0;
  let prevOnset: number | null = null;
  let prevWasGrace = false;
  for (const row of leaders) {
    if (prevOnset === null || row.onset !== prevOnset || row.isGrace || prevWasGrace) {
      order += 1;
      prevOnset = row.onset;
    }
    prevWasGrace = row.isGrace;
    out.set(row.el, order);
  }
  return out;
}

/** 같은 staff·같은 명시 po가 서로 다른 musical onset에 있으면 속성 제거(옛 전파 잔여). */
export function sanitizeConflictingPlayOrders(measure: Element): boolean {
  // voice-parallel onset — 단일 part cursor가 underfull forward 등으로 어긋나도
  // 같은 musical 동시성(같은 연주순번)을 다른 onset으로 오인하지 않음.
  const onsets = collectVoiceParallelNoteOnsets(measure);
  type Entry = { leader: Element; onset: number };
  const byStaffPo = new Map<string, Map<number, Entry[]>>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (isChordMember(child)) continue;
    const po = readPlayOrder(child);
    if (po == null) continue;
    const staff = noteStaffNumber(child);
    const staffMap = byStaffPo.get(String(staff)) ?? new Map<number, Entry[]>();
    const list = staffMap.get(po) ?? [];
    list.push({ leader: child, onset: onsets.get(child) ?? 0 });
    staffMap.set(po, list);
    byStaffPo.set(String(staff), staffMap);
  }
  let changed = false;
  for (const staffMap of byStaffPo.values()) {
    for (const entries of staffMap.values()) {
      const distinct = new Set(entries.map((e) => e.onset));
      if (distinct.size <= 1) continue;
      for (const { leader } of entries) {
        for (const note of noteGroupWithChords(measure, leader)) {
          if (note.hasAttribute(HITL_PLAY_ORDER_ATTR)) {
            note.removeAttribute(HITL_PLAY_ORDER_ATTR);
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

function buildMeasureDefaultPlayOrders(measure: Element, staves: Set<number>): Map<Element, number> {
  const out = new Map<Element, number>();
  for (const staffN of staves) {
    for (const [leader, po] of defaultPlayOrdersFromTimeline(measure, staffN)) {
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
    note.setAttribute(OSMD_LAYOUT_X_ATTR, x);
    note.setAttribute('default-x', x);
  }
}

function noteDurationValue(note: Element): number {
  const durEl = note.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(durEl?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 미리보기 layout onset — **musical onset ÷ 마디 길이** (앞 음표 박자만큼 누적한 위치).
 * 명시 연주순번이 같으면 같은 column(그 그룹 onset 최솟값). 저장 MXL timeline 불변.
 */
/** 명시 연주순번이 음표에만 있고 쉼표 leader에는 없으면 timeline으로 재배열. */
export function ensureRestPlayOrdersInMeasure(measure: Element): boolean {
  const staves = new Set<number>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (isChordMember(child)) continue;
    staves.add(noteStaffNumber(child));
  }
  let changed = false;
  for (const staffN of staves) {
    let hasRestWithout = false;
    let hasPitchedWith = false;
    for (const child of [...measure.children]) {
      if (xmlLocalName(child) !== 'note') continue;
      if (isChordMember(child)) continue;
      if (noteStaffNumber(child) !== staffN) continue;
      const po = readPlayOrder(child);
      if (isRestNote(child)) {
        if (po == null) hasRestWithout = true;
      } else if (po != null) {
        hasPitchedWith = true;
      }
    }
    if (!hasRestWithout || !hasPitchedWith) continue;
    const defaults = defaultPlayOrdersFromTimeline(measure, staffN);
    for (const [leader, order] of defaults) {
      if (readPlayOrderRef(leader)) continue; // 교차 voice 참조(5-6) 유지
      const orderS = String(order);
      for (const note of noteGroupWithChords(measure, leader)) {
        if (note.getAttribute(HITL_PLAY_ORDER_ATTR) !== orderS) {
          note.setAttribute(HITL_PLAY_ORDER_ATTR, orderS);
          changed = true;
        }
      }
    }
  }
  return changed;
}

export function applyPlayOrderLayoutToMeasure(measure: Element): void {
  // 연주순번이 layout 권위 — timeline onset이 어긋나도 같은 순번 column을 지우지 않음
  ensureRestPlayOrdersInMeasure(measure);
  const layoutLen = Math.max(1, previewLayoutLengthUnits(measure));
  const onsets = collectVoiceParallelNoteOnsets(measure);

  const staves = new Set<number>();
  for (const leader of allLeadersInMeasure(measure)) {
    staves.add(noteStaffNumber(leader));
  }
  const timelineDefaults = buildMeasureDefaultPlayOrders(measure, staves);

  /** 명시 숫자 또는 timeline 기본 — UI에 보이는 순번과 동일하게 참조(5-6)를 해석 */
  const effectiveOrder = (leader: Element): number | null => {
    const explicit = readPlayOrder(leader);
    if (explicit != null) return explicit;
    return timelineDefaults.get(leader) ?? null;
  };

  const staffsWithRefs = new Set<number>();
  for (const leader of allLeadersInMeasure(measure)) {
    if (readPlayOrderRef(leader)) staffsWithRefs.add(noteStaffNumber(leader));
  }

  const poColumnOnset = new Map<string, number>();
  for (const leader of allLeadersInMeasure(measure)) {
    const staff = noteStaffNumber(leader);
    // 참조가 있는 staff만 timeline 기본 순번도 열로 포함(5-6 → 6열 확보). 그 외는 명시 숫자만.
    const po = staffsWithRefs.has(staff) ? effectiveOrder(leader) : readPlayOrder(leader);
    if (po == null) continue;
    const key = `${staff}:${po}`;
    const onset = onsets.get(leader) ?? 0;
    const prev = poColumnOnset.get(key);
    poColumnOnset.set(key, prev == null ? onset : Math.min(prev, onset));
  }
  // 참조 대상 순번 열이 비어 있지 않게
  for (const leader of allLeadersInMeasure(measure)) {
    const ref = readPlayOrderRef(leader);
    if (!ref) continue;
    const staff = noteStaffNumber(leader);
    const key = `${staff}:${ref.order}`;
    if (!poColumnOnset.has(key)) poColumnOnset.set(key, 0);
  }

  // staff별 순번 오름차순 → 균등 column
  const rankOnsetByStaffPo = new Map<string, number>();
  const byStaff = new Map<number, number[]>();
  for (const key of poColumnOnset.keys()) {
    const [staffS, poS] = key.split(':');
    const staff = parseInt(staffS ?? '1', 10) || 1;
    const po = parseInt(poS ?? '0', 10);
    if (!Number.isFinite(po) || po < 1) continue;
    const list = byStaff.get(staff) ?? [];
    if (!list.includes(po)) list.push(po);
    byStaff.set(staff, list);
  }
  for (const [staff, pos] of byStaff) {
    const sorted = [...pos].sort((a, b) => a - b);
    const n = Math.max(1, sorted.length);
    sorted.forEach((po, i) => {
      const frac = n <= 1 ? 0 : i / (n - 1);
      rankOnsetByStaffPo.set(`${staff}:${po}`, frac * layoutLen);
    });
  }

  /** 앵커 voice·순번의 실제 layout onset — 명시 순번이면 균등 열, 없으면 musical onset */
  const layoutOnsetForAnchor = (staff: number, voice: number, order: number): number | null => {
    const voiceKey = String(voice);
    let best: number | null = null;
    for (const L of allLeadersInMeasure(measure)) {
      if (noteStaffNumber(L) !== staff) continue;
      if (noteVoiceNumber(L) !== voiceKey) continue;
      if (effectiveOrder(L) !== order) continue;
      const aSpec = readPlayOrderSpec(L);
      let onset: number;
      if (aSpec?.kind === 'order') {
        const key = `${staff}:${aSpec.order}`;
        onset = rankOnsetByStaffPo.get(key) ?? poColumnOnset.get(key) ?? onsets.get(L) ?? 0;
      } else {
        // timeline 기본만 — OSMD도 duration 배치이므로 musical onset이 SVG와 맞음
        onset = onsets.get(L) ?? 0;
      }
      best = best == null ? onset : Math.min(best, onset);
    }
    return best;
  };

  for (const leader of allLeadersInMeasure(measure)) {
    const musicalOnset = onsets.get(leader) ?? 0;
    const staff = noteStaffNumber(leader);
    const spec = readPlayOrderSpec(leader);
    let layoutOnset = musicalOnset;
    if (spec?.kind === 'order') {
      const key = `${staff}:${spec.order}`;
      layoutOnset = rankOnsetByStaffPo.get(key) ?? poColumnOnset.get(key) ?? musicalOnset;
    } else if (spec?.kind === 'ref') {
      // voice1의 6번째 등 — 앵커가 놓일 x와 동일 (균등 그리드로 강제하면 박 길이 다른 마디에서 6·7 사이로 밀림)
      layoutOnset =
        layoutOnsetForAnchor(staff, spec.voice, spec.order) ?? musicalOnset;
    }
    // 참조만 있는 staff에서 다른 음을 균등 그리드로 끌어가지 않음 — musical onset 유지
    setLayoutAttrsOnGroup(measure, leader, layoutOnset, layoutLen, null);
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

export type PreviewNoteLayoutTarget = {
  partId: string;
  measureNumber: number;
  staff: number;
  voice: string;
  pitch: string;
  defaultXTenths: number;
  /** 명시 `data-hitl-play-order` 숫자만 */
  playOrder: number | null;
  /** 명시 순번 또는 timeline 기본 — `1-6` 앵커 매칭용 */
  effectivePlayOrder: number | null;
  /** `5-6` — voice5 순번6 열에 맞춤 */
  playOrderAlign?: string | null;
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
        const staves = new Set<number>();
        for (const leader of allLeadersInMeasure(measure)) {
          staves.add(noteStaffNumber(leader));
        }
        const timelineByStaff = new Map<number, Map<Element, number>>();
        for (const st of staves) {
          timelineByStaff.set(st, defaultPlayOrdersFromTimeline(measure, st));
        }
        for (const leader of allLeadersInMeasure(measure)) {
          if (isGraceNote(leader)) continue;
          const rawX =
            leader.getAttribute(OSMD_LAYOUT_X_ATTR)?.trim() ||
            leader.getAttribute('default-x')?.trim();
          if (!rawX) continue;
          const defaultXTenths = parseFloat(rawX);
          if (!Number.isFinite(defaultXTenths)) continue;
          const playOrder = readPlayOrder(leader);
          const staff = noteStaffNumber(leader);
          const effectivePlayOrder =
            playOrder ?? timelineByStaff.get(staff)?.get(leader) ?? null;
          const ref = readPlayOrderRef(leader);
          const playOrderAlign = ref ? formatPlayOrderSpec({ kind: 'ref', ...ref }) : null;
          const voice = noteVoiceNumber(leader);
          if (isRestNote(leader)) {
            out.push({
              partId,
              measureNumber,
              staff,
              voice,
              pitch: 'REST',
              defaultXTenths,
              playOrder,
              effectivePlayOrder,
              playOrderAlign,
            });
            continue;
          }
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
              effectivePlayOrder,
              playOrderAlign,
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
          const rawX =
            leader.getAttribute(OSMD_LAYOUT_X_ATTR)?.trim() ||
            leader.getAttribute('default-x')?.trim();
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
  return previewLayoutLengthUnits(measure);
}
