/**
 * HITL 연주순번(가사순번) — 미리보기 배치·OSMD 정렬의 단일 기준.
 * 같은 순번 = 동시 시작 column. 저장 MXL voice·duration·빔은 불변.
 *
 * 미리보기 x: 연주순번·박자(onset) 비례. 편집기 voice·순번 문서 순서를 OSMD에 그대로 반영.
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

/** staff·voice에 명시 숫자 연주순번 또는 `5-6` 참조가 있으면 true. */
export function measureHasExplicitPlayOrder(measure: Element, staffN?: number): boolean {
  for (const leader of allLeadersInMeasure(measure)) {
    if (staffN != null && noteStaffNumber(leader) !== staffN) continue;
    if (readPlayOrder(leader) != null || readPlayOrderRef(leader) != null) return true;
  }
  return false;
}

/** 마디 중간 `<attributes><clef>` 가 있으면 true (onset reorder가 clef 위치를 깨뜨림). */
export function measureHasMidClefAttributes(measure: Element, staffN?: number): boolean {
  let seenNote = false;
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'note') {
      seenNote = true;
      continue;
    }
    if (!seenNote || tag !== 'attributes') continue;
    const clef = child.querySelector(':scope > clef, :scope > *|clef');
    if (!clef) continue;
    if (staffN == null) return true;
    const num = clef.getAttribute('number')?.trim();
    const clefStaff = num && /^\d+$/.test(num) ? parseInt(num, 10) : 1;
    if (clefStaff === staffN) return true;
  }
  return false;
}

/**
 * backup 구간별로 voice 스트림 내 음표(화음 그룹)를 연주순번 오름차순으로 재배치.
 * 편집기 `_snapshot_timeline_sort_key`(staff, voice, po)와 동일 — OSMD가 문서 순서로 그리므로 미리보기 전용.
 */
export function reorderMeasureNotesByPlayOrderForOsmdPreview(measure: Element): boolean {
  const children = [...measure.children];
  const backupIdx: number[] = [];
  for (let i = 0; i < children.length; i += 1) {
    if (xmlLocalName(children[i]!) === 'backup') backupIdx.push(i);
  }
  const segmentBounds: Array<[number, number]> = [];
  let segStart = 0;
  for (const bi of backupIdx) {
    segmentBounds.push([segStart, bi]);
    segStart = bi + 1;
  }
  segmentBounds.push([segStart, children.length]);

  let changed = false;
  for (const [start, end] of segmentBounds) {
    if (end <= start) continue;
    const segment = children.slice(start, end);
    type NoteGroup = { leader: Element; group: Element[]; po: number; docIdx: number };
    const noteGroups: NoteGroup[] = [];
    let docIdx = 0;
    for (const el of segment) {
      if (xmlLocalName(el) !== 'note') continue;
      if (isChordMember(el)) continue;
      noteGroups.push({
        leader: el,
        group: noteGroupWithChords(measure, el),
        po: readPlayOrder(el) ?? 999_999,
        docIdx: docIdx++,
      });
    }
    if (noteGroups.length < 2) continue;
    if (!noteGroups.some((g) => readPlayOrder(g.leader) != null)) continue;
    const sorted = [...noteGroups].sort((a, b) => a.po - b.po || a.docIdx - b.docIdx);
    if (sorted.every((s, i) => s.leader === noteGroups[i]!.leader)) continue;

    const firstNoteInSeg = segment.find(
      (el) => xmlLocalName(el) === 'note' && !isChordMember(el),
    );
    if (!firstNoteInSeg) continue;

    const insertIdx = [...measure.children].indexOf(firstNoteInSeg);
    if (insertIdx < 0) continue;

    for (const g of noteGroups) {
      for (const n of g.group) measure.removeChild(n);
    }
    const orderedFrag = measure.ownerDocument!.createDocumentFragment();
    for (const g of sorted) {
      for (const n of g.group) {
        orderedFrag.appendChild(n);
      }
    }
    measure.insertBefore(orderedFrag, measure.children[insertIdx] ?? null);
    changed = true;
  }
  return changed;
}

export function reorderPlayOrderDocumentOrderInXml(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    let changed = false;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        if (reorderMeasureNotesByPlayOrderForOsmdPreview(measure)) changed = true;
      }
    }
    return changed ? serializeMusicXmlDocument(doc) : xml;
  } catch {
    return xml;
  }
}

function leaderDurationValue(leader: Element): number {
  const d = leader.querySelector(':scope > duration, :scope > *|duration');
  const n = parseInt(d?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function forwardVoiceN(el: Element, fallback: string): string {
  const v = el.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
  return v || fallback;
}

function buildPoColumnOnsetsForMeasure(measure: Element): Map<string, number> {
  return buildPoColumnInfosForMeasure(measure).onsets;
}

/** staff:po → 열 onset + 그 min을 만든 voice들 (cross-voice trim 가드용). */
function buildPoColumnInfosForMeasure(measure: Element): {
  onsets: Map<string, number>;
  voicesAtMin: Map<string, Set<string>>;
} {
  const onsetsMap = collectVoiceParallelNoteOnsets(measure);
  const staves = new Set<number>();
  for (const leader of allLeadersInMeasure(measure)) staves.add(noteStaffNumber(leader));
  const timelineDefaults = buildMeasureDefaultPlayOrders(measure, staves);
  const effectiveOrder = (leader: Element): number | null => {
    const explicit = readPlayOrder(leader);
    if (explicit != null) return explicit;
    return timelineDefaults.get(leader) ?? null;
  };
  const poColumnOnset = new Map<string, number>();
  const voicesAtMin = new Map<string, Set<string>>();
  for (const leader of allLeadersInMeasure(measure)) {
    const staff = noteStaffNumber(leader);
    const po = effectiveOrder(leader);
    if (po == null) continue;
    const key = `${staff}:${po}`;
    const onset = onsetsMap.get(leader) ?? 0;
    const voice = noteVoiceNumber(leader);
    const prev = poColumnOnset.get(key);
    if (prev == null || onset < prev - 0.01) {
      poColumnOnset.set(key, onset);
      voicesAtMin.set(key, new Set([voice]));
    } else if (Math.abs(onset - prev) <= 0.01) {
      voicesAtMin.get(key)?.add(voice);
    }
  }
  for (const leader of allLeadersInMeasure(measure)) {
    const ref = readPlayOrderRef(leader);
    if (!ref) continue;
    const staff = noteStaffNumber(leader);
    const key = `${staff}:${ref.order}`;
    if (!poColumnOnset.has(key)) {
      poColumnOnset.set(key, 0);
      voicesAtMin.set(key, new Set());
    }
  }
  return { onsets: poColumnOnset, voicesAtMin };
}

function previousNoteLeaderInVoice(measure: Element, leader: Element): Element | null {
  const wantVoice = noteVoiceNumber(leader);
  const children = [...measure.children];
  const idx = children.indexOf(leader);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const el = children[i]!;
    if (xmlLocalName(el) === 'backup') return null;
    if (xmlLocalName(el) !== 'note') continue;
    if (isChordMember(el)) continue;
    if (noteVoiceNumber(el) === wantVoice) return el;
  }
  return null;
}

function reduceLeadingForwardForNote(measure: Element, leader: Element, reduceBy: number): boolean {
  if (reduceBy <= 0) return false;
  const wantVoice = noteVoiceNumber(leader);
  const children = [...measure.children];
  const leaderIdx = children.indexOf(leader);
  if (leaderIdx < 0) return false;
  let reduceLeft = reduceBy;
  let changed = false;
  for (let i = leaderIdx - 1; i >= 0 && reduceLeft > 0; i -= 1) {
    const el = children[i]!;
    const tag = xmlLocalName(el);
    if (tag === 'backup') break;
    if (tag !== 'forward') continue;
    if (forwardVoiceN(el, wantVoice) !== wantVoice) continue;
    const durEl = el.querySelector(':scope > duration, :scope > *|duration');
    const dur = parseInt(durEl?.textContent?.trim() ?? '0', 10) || 0;
    if (dur <= 0) continue;
    const take = Math.min(dur, reduceLeft);
    const newDur = dur - take;
    reduceLeft -= take;
    changed = true;
    if (newDur <= 0) el.remove();
    else durEl!.textContent = String(newDur);
  }
  return changed;
}

function increaseLeadingForwardForNote(measure: Element, leader: Element, increaseBy: number): boolean {
  if (increaseBy <= 0) return false;
  const doc = measure.ownerDocument;
  if (!doc) return false;
  const wantVoice = noteVoiceNumber(leader);
  const children = [...measure.children];
  const leaderIdx = children.indexOf(leader);
  if (leaderIdx < 0) return false;
  const prev = leaderIdx > 0 ? children[leaderIdx - 1]! : null;
  if (prev && xmlLocalName(prev) === 'forward' && forwardVoiceN(prev, wantVoice) === wantVoice) {
    const durEl = prev.querySelector(':scope > duration, :scope > *|duration');
    const dur = parseInt(durEl?.textContent?.trim() ?? '0', 10) || 0;
    if (durEl) durEl.textContent = String(dur + increaseBy);
    return true;
  }
  const forward = doc.createElementNS(measure.namespaceURI, 'forward');
  const dur = doc.createElementNS(measure.namespaceURI, 'duration');
  dur.textContent = String(increaseBy);
  forward.appendChild(dur);
  const voiceEl = doc.createElementNS(measure.namespaceURI, 'voice');
  voiceEl.textContent = wantVoice;
  forward.appendChild(voiceEl);
  measure.insertBefore(forward, leader);
  return true;
}

/** 앵커 voice·순번 column의 musical onset — `1-3` 참조·layout-x 공통. */
function layoutOnsetForAnchorInMeasure(
  measure: Element,
  staff: number,
  anchorVoice: number,
  order: number,
): number | null {
  const onsets = collectVoiceParallelNoteOnsets(measure);
  const staves = new Set<number>();
  for (const leader of allLeadersInMeasure(measure)) staves.add(noteStaffNumber(leader));
  const timelineDefaults = buildMeasureDefaultPlayOrders(measure, staves);
  const poColumnOnset = buildPoColumnOnsetsForMeasure(measure);
  const voiceKey = String(anchorVoice);
  let best: number | null = null;
  for (const L of allLeadersInMeasure(measure)) {
    if (noteStaffNumber(L) !== staff) continue;
    if (noteVoiceNumber(L) !== voiceKey) continue;
    const eff = readPlayOrder(L) ?? timelineDefaults.get(L) ?? null;
    if (eff !== order) continue;
    const aSpec = readPlayOrderSpec(L);
    let onset: number;
    if (aSpec?.kind === 'order') {
      const key = `${staff}:${aSpec.order}`;
      onset = poColumnOnset.get(key) ?? onsets.get(L) ?? 0;
    } else {
      onset = onsets.get(L) ?? 0;
    }
    best = best == null ? onset : Math.min(best, onset);
  }
  return best;
}

function trimPreviousNoteToOnset(measure: Element, leader: Element, targetOnset: number): boolean {
  const prev = previousNoteLeaderInVoice(measure, leader);
  if (!prev) return false;
  const onsets = collectVoiceParallelNoteOnsets(measure);
  const prevStart = onsets.get(prev) ?? 0;
  const maxDur = targetOnset - prevStart;
  if (maxDur <= 0) return false;
  const durEl = prev.querySelector(':scope > duration, :scope > *|duration');
  if (!durEl) return false;
  const dur = leaderDurationValue(prev);
  if (dur <= maxDur) return false;
  durEl.textContent = String(maxDur);
  return true;
}

/**
 * partial voice — 명시 연주순번 voice의 onset을 column(앵커 voice timeline)에 맞춤.
 * OSMD가 backup/forward 타임라인으로 그리므로 미리보기 XML만 조정(저장 MXL 불변).
 *
 * REGRESSION: npx tsx _smoke/test_partial_voice_regression.ts
 * DO NOT remove from repairTimelineForOsmdPreview faithful path (after reorder, before layout).
 */
export function realignMeasureTimelineToPlayOrderColumnsForOsmdPreview(measure: Element): boolean {
  const allVoices = new Set(allLeadersInMeasure(measure).map(noteVoiceNumber));
  if (allVoices.size < 2) return false;

  // partial voice(앞에 forward가 있는 성부)만 다른 voice 열에 맞추기 위해 앞 음 duration trim 허용.
  // 일반 병행 성부(예: PL bass half)는 잘라서 슬러·리듬을 깨지 않음.
  const voicesWithForward = new Set<string>();
  let fwdFallback = '1';
  for (const el of [...measure.children]) {
    const tag = xmlLocalName(el);
    if (tag === 'note' && !isChordMember(el)) {
      fwdFallback = noteVoiceNumber(el);
    } else if (tag === 'forward') {
      voicesWithForward.add(forwardVoiceN(el, fwdFallback));
    }
  }

  const { onsets: poColumnOnset, voicesAtMin } = buildPoColumnInfosForMeasure(measure);
  type Row = { leader: Element; target: number; sortKey: number; columnKey: string };
  const rows: Row[] = [];
  for (const leader of allLeadersInMeasure(measure)) {
    const staff = noteStaffNumber(leader);
    const po = readPlayOrder(leader);
    if (po != null) {
      const columnKey = `${staff}:${po}`;
      const target = poColumnOnset.get(columnKey);
      if (target != null) rows.push({ leader, target, sortKey: po, columnKey });
      continue;
    }
    const ref = readPlayOrderRef(leader);
    if (ref == null) continue;
    const columnKey = `${staff}:${ref.order}`;
    const target = layoutOnsetForAnchorInMeasure(measure, staff, ref.voice, ref.order);
    if (target != null) rows.push({ leader, target, sortKey: ref.order, columnKey });
  }
  if (rows.length === 0) return false;

  rows.sort((a, b) => a.sortKey - b.sortKey);
  let changed = false;
  for (const { leader, target, columnKey } of rows) {
    let onsets = collectVoiceParallelNoteOnsets(measure);
    let current = onsets.get(leader) ?? 0;
    if (Math.abs(current - target) <= 0.01) continue;

    if (current > target) {
      const leaderVoice = noteVoiceNumber(leader);
      const colVoices = voicesAtMin.get(columnKey);
      const crossVoiceColumn =
        !!colVoices &&
        colVoices.size > 0 &&
        ![...colVoices].every((v) => v === leaderVoice);
      const allowDurationTrim = !crossVoiceColumn || voicesWithForward.has(leaderVoice);
      if (allowDurationTrim && previousNoteLeaderInVoice(measure, leader)) {
        changed = trimPreviousNoteToOnset(measure, leader, target) || changed;
        onsets = collectVoiceParallelNoteOnsets(measure);
        current = onsets.get(leader) ?? 0;
      }
      const delta = current - target;
      if (delta > 0.01) {
        changed = reduceLeadingForwardForNote(measure, leader, delta) || changed;
      }
    } else {
      const delta = target - current;
      if (delta > 0.01) {
        changed = increaseLeadingForwardForNote(measure, leader, delta) || changed;
      }
    }
  }
  return changed;
}

export function realignPlayOrderColumnTimelinesInXml(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    let changed = false;
    for (const part of findXmlParts(doc)) {
      for (const child of [...part.children]) {
        if (xmlLocalName(child) !== 'measure') continue;
        if (realignMeasureTimelineToPlayOrderColumnsForOsmdPreview(child)) changed = true;
      }
    }
    return changed ? serializeMusicXmlDocument(doc) : xml;
  } catch {
    return xml;
  }
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

  const poColumnOnset = new Map<string, number>();
  for (const leader of allLeadersInMeasure(measure)) {
    const staff = noteStaffNumber(leader);
    // 명시·timeline 기본 순번 모두 column 후보 — voice2만 po=1인데 voice1 기본 1열이
    // 빠지면 partial voice가 자기 musical onset에 붙는 문제(예: d60 m33 PL).
    const po = effectiveOrder(leader);
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

  // staff별 순번 → musical onset(박자 누적). 균등 column grid는 쓰지 않음 — 편집기 순번·박자 그대로.
  for (const leader of allLeadersInMeasure(measure)) {
    const musicalOnset = onsets.get(leader) ?? 0;
    const staff = noteStaffNumber(leader);
    const spec = readPlayOrderSpec(leader);
    let layoutOnset = musicalOnset;
    if (spec?.kind === 'order') {
      const key = `${staff}:${spec.order}`;
      layoutOnset = poColumnOnset.get(key) ?? musicalOnset;
    } else if (spec?.kind === 'ref') {
      layoutOnset =
        layoutOnsetForAnchorInMeasure(measure, staff, spec.voice, spec.order) ?? musicalOnset;
    }
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
