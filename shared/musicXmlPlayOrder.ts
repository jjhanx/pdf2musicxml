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

function appendTimelineForward(measure: Element, duration: number): void {
  if (duration <= 0) return;
  const doc = measure.ownerDocument!;
  if (!doc) return;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const fwd = ns ? doc.createElementNS(ns, 'forward') : doc.createElement('forward');
  const dur = ns ? doc.createElementNS(ns, 'duration') : doc.createElement('duration');
  dur.textContent = String(duration);
  fwd.appendChild(dur);
  measure.appendChild(fwd);
}

function appendTimelineBackup(measure: Element, duration: number): void {
  if (duration <= 0) return;
  const doc = measure.ownerDocument!;
  if (!doc) return;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const backup = ns ? doc.createElementNS(ns, 'backup') : doc.createElement('backup');
  const dur = ns ? doc.createElementNS(ns, 'duration') : doc.createElement('duration');
  dur.textContent = String(duration);
  backup.appendChild(dur);
  measure.appendChild(backup);
}

function setNoteVoice(note: Element, voice: string): void {
  let vEl = note.querySelector(':scope > voice, :scope > *|voice');
  if (!vEl) {
    const doc = note.ownerDocument!;
    const ns = note.namespaceURI || 'http://www.musicxml.org/ns/partwise';
    vEl = ns ? doc.createElementNS(ns, 'voice') : doc.createElement('voice');
    const dur = note.querySelector('duration, *|duration');
    if (dur?.nextSibling) note.insertBefore(vEl, dur.nextSibling);
    else note.appendChild(vEl);
  }
  vEl.textContent = voice;
}

function appendNoteGroupToMeasure(measure: Element, group: Element[], voice: string): void {
  for (const note of group) {
    setNoteVoice(note, voice);
    measure.appendChild(note);
  }
}

function chainTotalDuration(chain: Element[]): number {
  return chain.reduce((sum, l) => sum + noteDurationValue(l), 0);
}

/** 같은 onset의 leader들을 beam chain 단위로 분리. */
function leadersToBeamChains(leaders: Element[]): Element[][] {
  const chains: Element[][] = [];
  const used = new Set<Element>();
  for (const l of leaders) {
    if (used.has(l)) continue;
    const beamStart = findBeamStartLeader(leaders, l);
    if (beamStart && beamStart !== l) continue;
    const chain = [l];
    used.add(l);
    const startIdx = leaders.indexOf(l);
    for (let j = startIdx + 1; j < leaders.length; j += 1) {
      const next = leaders[j]!;
      const bs = findBeamStartLeader(leaders, next);
      if (bs && chain.includes(bs)) {
        chain.push(next);
        used.add(next);
      } else break;
    }
    chains.push(chain);
  }
  for (const l of leaders) {
    if (!used.has(l)) chains.push([l]);
  }
  return chains;
}

/**
 * OSMD는 voice timeline으로 spacing — default-x만으론 부족.
 * layout onset 기준으로 voice·backup·forward 재구성(미리보기 전용).
 */
function rebuildStaffTimelineFromPlayOrderLayout(
  measure: Element,
  staffN: number,
  layout: Map<Element, number>,
): void {
  const staffLeaders = noteLeadersOnStaff(measure, staffN);
  if (!staffLeaders.length) return;

  const leaderGroups = new Map<Element, Element[]>();
  for (const l of staffLeaders) {
    leaderGroups.set(l, [...noteGroupWithChords(measure, l)]);
  }

  const sortedLeaders = [...staffLeaders].sort((a, b) => {
    const oa = layout.get(a) ?? 0;
    const ob = layout.get(b) ?? 0;
    if (oa !== ob) return oa - ob;
    return staffLeaders.indexOf(a) - staffLeaders.indexOf(b);
  });

  const onsetGroups: Element[][] = [];
  for (const l of sortedLeaders) {
    const o = layout.get(l) ?? 0;
    const last = onsetGroups[onsetGroups.length - 1];
    if (last && (layout.get(last[0]!) ?? 0) === o) last.push(l);
    else onsetGroups.push([l]);
  }

  /** 같은 onset·같은 pitch 중복 leader는 1개만 (OMR 잔여). */
  for (let gi = 0; gi < onsetGroups.length; gi += 1) {
    const group = onsetGroups[gi]!;
    const seen = new Set<string>();
    onsetGroups[gi] = group.filter((l) => {
      const p = xmlPitchLabel(l);
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    });
  }

  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'backup' || tag === 'forward') {
      child.remove();
      continue;
    }
    if (tag === 'note' && noteStaffNumber(child) === staffN) child.remove();
  }

  const PRIMARY = '1';
  const voiceCursor = new Map<string, number>();
  const leaderVoice = new Map<Element, string>();
  let nextVoice = 2;

  for (const group of onsetGroups) {
    const onset = layout.get(group[0]!) ?? 0;
    const first = group[0]!;
    const beamStart = findBeamStartLeader(staffLeaders, first, true);

    if (beamStart && beamStart !== first && leaderVoice.has(beamStart)) {
      const voice = leaderVoice.get(beamStart)!;
      let cursor = voiceCursor.get(voice) ?? 0;
      if (onset > cursor) {
        appendTimelineForward(measure, onset - cursor);
        cursor = onset;
      }
      for (const l of group) {
        appendNoteGroupToMeasure(measure, leaderGroups.get(l) ?? [l], voice);
        leaderVoice.set(l, voice);
        cursor += noteDurationValue(l);
      }
      voiceCursor.set(voice, cursor);
      continue;
    }

    const chains = leadersToBeamChains(group);
    chains.sort((a, b) => chainTotalDuration(b) - chainTotalDuration(a));

    const primaryChain = chains[0]!;
    const primaryDur = chainTotalDuration(primaryChain);

    let v1 = voiceCursor.get(PRIMARY) ?? 0;
    if (onset > v1) {
      appendTimelineForward(measure, onset - v1);
      v1 = onset;
    }
    for (const l of primaryChain) {
      appendNoteGroupToMeasure(measure, leaderGroups.get(l) ?? [l], PRIMARY);
      leaderVoice.set(l, PRIMARY);
    }
    voiceCursor.set(PRIMARY, onset + primaryDur);

    for (let ci = 1; ci < chains.length; ci += 1) {
      const chain = chains[ci]!;
      const sv = String(nextVoice++);
      appendTimelineBackup(measure, primaryDur);
      let cursor = onset;
      for (const l of chain) {
        appendNoteGroupToMeasure(measure, leaderGroups.get(l) ?? [l], sv);
        leaderVoice.set(l, sv);
        cursor += noteDurationValue(l);
      }
      voiceCursor.set(sv, cursor);
    }
  }
}

/** 마디 공통 grid — 순번·박자 → default-x + voice timeline 재구성. */
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

  for (const staffN of staves) {
    rebuildStaffTimelineFromPlayOrderLayout(measure, staffN, layout);
  }
}

/** @deprecated voice timeline 재구성(rebuildStaffTimelineFromPlayOrderLayout)으로 대체. */
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
