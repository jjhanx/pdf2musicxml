import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function findXmlParts(doc: Document): Element[] {
  const out: Element[] = [];
  const root = doc.documentElement;
  if (!root) return out;
  const walk = (el: Element) => {
    if (xmlLocalName(el) === 'part') out.push(el);
    for (const c of [...el.children]) walk(c);
  };
  walk(root);
  return out;
}

function hasNoteAfter(measure: Element, index: number): boolean {
  for (let i = index + 1; i < measure.children.length; i++) {
    if (xmlLocalName(measure.children[i]!) === 'note') return true;
  }
  return false;
}

function hasNoteBefore(measure: Element, index: number): boolean {
  for (let i = 0; i < index; i++) {
    if (xmlLocalName(measure.children[i]!) === 'note') return true;
  }
  return false;
}

function removeDanglingTimelineInMeasure(measure: Element): void {
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag !== 'backup' && tag !== 'forward') continue;
    const idx = [...measure.children].indexOf(child);
    if (idx < 0) continue;
    const hasAfter = hasNoteAfter(measure, idx);
    const hasBefore = hasNoteBefore(measure, idx);
    if (tag === 'forward') {
      if (!hasAfter) child.remove();
      continue;
    }
    if (!hasAfter || !hasBefore) child.remove();
  }
}

/** OSMD/HITL 미리보기 전용 — dangling timeline + `<print>`·Audiveris 레이아웃 힌트 제거(저장 MXL 불변). */
export function repairTimelineForOsmdPreview(xml: string): string {
  let out = removeDanglingTimelineElementsForOsmdPreview(xml);
  out = capBackupDurationsForOsmdPreview(out);
  out = stripPrintElementsForOsmdPreview(out);
  out = stripMeasureWidthAttributesForOsmdPreview(out);
  out = stripDefaultXyForOsmdPreview(out);
  out = realignDefaultXFromStaffTimelineForOsmdPreview(out);
  out = stripChordBeamsForOsmdPreview(out);
  return out;
}

/**
 * OSMD/HITL 미리보기 전용 — Audiveris `<print>`의 layout 자식·좌표는 제거하되
 * `new-page`/`new-system`은 빈 `<print new-system="yes"/>`로 남겨 OSMD가 줄바꿈을 인식하게 함.
 * layout·measure-numbering·system-margins 등이 남으면 0·음수 마디 폭·한 칸 밀림(26→27)이 난다.
 */
export function stripPrintElementsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        for (const child of [...measure.children]) {
          if (xmlLocalName(child) !== 'print') continue;
          const needsBreak =
            child.getAttribute('new-page') === 'yes' || child.getAttribute('new-system') === 'yes';
          const insertAt = [...measure.children].indexOf(child);
          child.remove();
          if (!needsBreak) continue;
          const docRef = measure.ownerDocument;
          if (!docRef) continue;
          const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
          const minimal = ns ? docRef.createElementNS(ns, 'print') : docRef.createElement('print');
          minimal.setAttribute('new-system', 'yes');
          measure.insertBefore(minimal, measure.children[insertAt] ?? null);
        }
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/**
 * OSMD/HITL 미리보기 전용 — note·direction 등 Audiveris `default-x`/`default-y` 제거.
 * 페이지·시스템 경계에서 절대 X가 OSMD 자동 줄바꿈·마디 폭 계산을 깨뜨려 0폭·skip·한 칸 밀림을 유발할 수 있음.
 */
export function stripDefaultXyForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    doc.querySelectorAll('*').forEach((el) => {
      el.removeAttribute('default-x');
      el.removeAttribute('default-y');
    });
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/**
 * OSMD/HITL 미리보기 전용 — Audiveris `measure@width` 제거.
 * OSMD가 인쇄 폭(tenths)을 그대로 쓰면 `<print>` 제거 후 **width≤0** 으로 마디가 0폭·skip되어
 * 다음 마디(27) 내용이 26칸에 그려지는 현상이 난다(`SkyBottomLineBatchCalculatorBackend: width not > 0`).
 */
export function stripMeasureWidthAttributesForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    doc.querySelectorAll('measure, *|measure').forEach((el) => {
      el.removeAttribute('width');
    });
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/**
 * OSMD/HITL 미리보기 전용 — chord 노트의 beam 제거.
 * MusicXML 스펙상 beam은 화음의 주 노트에만 있어야 하지만, 일부 OMR은 화음의 모든 노트에 beam을 달기도 합니다.
 * 이 경우 OSMD의 SkyBottomLineBatchCalculatorBackend 등에서 width를 0으로 계산하여 
 * 마디 전체가 스킵되는 치명적 렌더링 오류(예: 26마디 실종)를 유발할 수 있습니다.
 */
export function stripChordBeamsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    
    // 화음 노트를 찾아 내부의 beam을 모두 제거
    doc.querySelectorAll('note, *|note').forEach((note) => {
      const hasChord = note.querySelector('chord, *|chord') !== null;
      if (hasChord) {
        note.querySelectorAll('beam, *|beam').forEach((beam) => beam.remove());
      }
    });
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/**
 * OSMD/HITL 미리보기 전용 — `<print new-page="yes">` 제거(연속 스크롤 레이아웃).
 * @deprecated stripPrintElementsForOsmdPreview — `<print>` 전체 제거가 더 안전
 */
export function stripPageBreakPrintForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    doc.querySelectorAll('*').forEach((el) => {
      if (xmlLocalName(el) !== 'print') return;
      el.removeAttribute('new-page');
      if (el.attributes.length === 0 && el.childElementCount === 0) el.remove();
    });
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/**
 * OSMD/HITL 미리보기 전용 — `<print new-system="yes">` 제거.
 * @deprecated stripPrintElementsForOsmdPreview
 */
export function stripNewSystemPrintForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    doc.querySelectorAll('*').forEach((el) => {
      if (xmlLocalName(el) !== 'print') return;
      el.removeAttribute('new-system');
      if (el.attributes.length === 0 && el.childElementCount === 0) el.remove();
    });
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/** MusicXML `<print new-page="yes">` 순서로 PDF 페이지 → 첫 `measure@number` (part 1 기준). */
export function inferFirstMxlMeasureForPdfPage(xml: string, pdfPage: number): number {
  const pageN = Math.max(1, Math.floor(pdfPage));
  if (pageN === 1) return 1;
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return 1;
    const parts = findXmlParts(doc);
    const part = parts[0];
    if (!part) return 1;
    const pageStarts = new Map<number, number>();
    pageStarts.set(1, 1);
    let page = 1;
    for (const measure of [...part.children]) {
      if (xmlLocalName(measure) !== 'measure') continue;
      const mnum = parseInt(measure.getAttribute('number') ?? '0', 10);
      if (!Number.isFinite(mnum) || mnum < 1) continue;
      if (!pageStarts.has(page)) pageStarts.set(page, mnum);
      for (const child of [...measure.children]) {
        if (xmlLocalName(child) !== 'print') continue;
        if (child.getAttribute('new-page') !== 'yes') continue;
        page += 1;
        pageStarts.set(page, mnum);
      }
    }
    return pageStarts.get(pageN) ?? pageStarts.get(1) ?? 1;
  } catch {
    return 1;
  }
}

/**
 * OSMD/HITL 미리보기 전용 — 같은 마디 안에서 `<backup>`/`<forward>` 앞뒤에 `<note>`가 없으면 제거.
 * Audiveris orphan backup(25마디 끝 backup만·voice 2 비어 있음) → OSMD가 26마디를 건너뛰고 27 내용이 26 칸에 그려짐.
 */
export function removeDanglingTimelineElementsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        removeDanglingTimelineInMeasure(measure);
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/** 테스트·진단 — trailing backup/forward 개수 */
export function countDanglingTimelineElements(xml: string): number {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return 0;
    let n = 0;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        for (let i = 0; i < measure.children.length; i++) {
          const tag = xmlLocalName(measure.children[i]!);
          if (tag !== 'backup' && tag !== 'forward') continue;
          const hasAfter = hasNoteAfter(measure, i);
          const hasBefore = hasNoteBefore(measure, i);
          if (tag === 'forward') {
            if (!hasAfter) n += 1;
          } else if (!hasAfter || !hasBefore) {
            n += 1;
          }
        }
      }
    }
    return n;
  } catch {
    return 0;
  }
}

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

function measureLengthUnits(measure: Element): number {
  let divisions = 1;
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
  return Math.max(1, Math.round((divisions * beats * 4) / beatType));
}

function staffTimedLeaderStarts(
  measure: Element,
  staffN: number,
): Array<{ note: Element; start: number }> {
  const voiceCursor = new Map<string, number>();
  let lastNoteVoice = '1';
  const out: Array<{ note: Element; start: number }> = [];
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'backup') {
      const v = timelineVoiceEl(child, lastNoteVoice);
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - timelineDurationEl(child)));
    } else if (tag === 'forward') {
      const v = timelineVoiceEl(child, lastNoteVoice);
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + timelineDurationEl(child));
    } else if (tag === 'note') {
      if (child.querySelector('chord, *|chord') !== null) continue;
      if (noteStaffNumber(child) !== staffN) continue;
      const voice = noteVoiceNumber(child);
      lastNoteVoice = voice;
      const start = voiceCursor.get(voice) ?? 0;
      out.push({ note: child, start });
      voiceCursor.set(voice, start + noteDurationValue(child));
    }
  }
  return out;
}

function setDefaultXOnChordGroup(measure: Element, leader: Element, x: string): void {
  leader.setAttribute('default-x', x);
  const children = [...measure.children];
  const start = children.indexOf(leader);
  if (start < 0) return;
  for (let i = start + 1; i < children.length; i += 1) {
    const el = children[i]!;
    if (xmlLocalName(el) !== 'note') break;
    if (el.querySelector('chord, *|chord') === null) break;
    el.setAttribute('default-x', x);
  }
}

function realignMeasureDefaultXFromTimeline(measure: Element): void {
  const measureLen = measureLengthUnits(measure);
  const baseX = 32;
  const span = 400;
  const staves = new Set<number>();
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note') staves.add(noteStaffNumber(child));
  }
  for (const staffN of staves) {
    for (const { note, start } of staffTimedLeaderStarts(measure, staffN)) {
      const x = (baseX + (start / measureLen) * span).toFixed(2);
      setDefaultXOnChordGroup(measure, note, x);
    }
  }
}

/** 단일 마디 OSMD 미리보기 — voice timeline 시작 시점으로 default-x 재주입. */
export function realignMeasureDefaultXFromTimelineForOsmd(measure: Element): void {
  realignMeasureDefaultXFromTimeline(measure);
}

function noteGroupWithChords(measure: Element, leader: Element): Element[] {
  const group: Element[] = [leader];
  const siblings = [...measure.children];
  const start = siblings.indexOf(leader);
  if (start < 0) return group;
  for (let j = start + 1; j < siblings.length; j += 1) {
    const next = siblings[j]!;
    if (xmlLocalName(next) !== 'note') break;
    if (next.querySelector('chord, *|chord') === null) break;
    group.push(next);
  }
  return group;
}

function ensureChordTag(note: Element): void {
  if (note.querySelector('chord, *|chord') !== null) return;
  const doc = note.ownerDocument;
  if (!doc) return;
  const ns = note.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const chord = ns ? doc.createElementNS(ns, 'chord') : doc.createElement('chord');
  const pitch = note.querySelector('pitch, *|pitch');
  if (pitch) note.insertBefore(chord, pitch);
  else note.insertBefore(chord, note.firstChild);
}

function setNoteVoice(note: Element, voice: string): void {
  let voiceEl = note.querySelector(':scope > voice, :scope > *|voice');
  if (!voiceEl) {
    const doc = note.ownerDocument!;
    const ns = note.namespaceURI || 'http://www.musicxml.org/ns/partwise';
    voiceEl = ns ? doc.createElementNS(ns, 'voice') : doc.createElement('voice');
    const dur = note.querySelector('duration, *|duration');
    if (dur?.nextSibling) note.insertBefore(voiceEl, dur.nextSibling);
    else note.appendChild(voiceEl);
  }
  voiceEl.textContent = voice;
}

function voiceLeaderHadForwardPrefix(measure: Element, leader: Element, voice: string): boolean {
  let seenForward = false;
  for (const child of [...measure.children]) {
    if (child === leader) return seenForward;
    const tag = xmlLocalName(child);
    if (tag === 'forward' && timelineVoiceEl(child, '1') === voice) seenForward = true;
    if (tag === 'note' && noteVoiceNumber(child) === voice && child.querySelector('chord, *|chord') === null) {
      seenForward = false;
    }
  }
  return false;
}

function nextNonChordSibling(measure: Element, leader: Element): Element | null {
  const siblings = [...measure.children];
  const start = siblings.indexOf(leader);
  if (start < 0) return null;
  for (let i = start + 1; i < siblings.length; i += 1) {
    const el = siblings[i]!;
    if (xmlLocalName(el) !== 'note') return el;
    if (el.querySelector('chord, *|chord') === null) return el;
  }
  return null;
}

function removeForwardBeforeNote(measure: Element, note: Element, voice: string): void {
  const siblings = [...measure.children];
  const idx = siblings.indexOf(note);
  if (idx <= 0) return;
  for (let i = idx - 1; i >= 0; i -= 1) {
    const el = siblings[i]!;
    const tag = xmlLocalName(el);
    if (tag === 'forward' && timelineVoiceEl(el, voice) === voice) {
      el.remove();
      return;
    }
    if (tag === 'note' || tag === 'backup') break;
  }
}

function noteTypeWeight(note: Element): number {
  const type = note.querySelector('type, *|type')?.textContent?.trim() ?? '';
  const rank: Record<string, number> = {
    breve: 8,
    whole: 7,
    half: 6,
    quarter: 5,
    eighth: 4,
    '16th': 3,
    '32nd': 2,
    '64th': 1,
  };
  return rank[type] ?? noteDurationValue(note);
}

function noteHasBeamTag(note: Element): boolean {
  return note.querySelector('beam, *|beam') !== null;
}

/**
 * OSMD split-staff 미리보기 — `<forward>`로 맞춘 동시 onset(다른 voice)을 **긴 duration leader + chord** 로 합침.
 * **`<beam>`이 있는 음(E5 8분 빔 등)은 합치지 않음** — 4분 leader chord로 8분이 4분·빔 끊김 회귀 방지.
 */
export function mergeSameOnsetVoicesForOsmdPreview(measure: Element): boolean {
  const leaders: Array<{ note: Element; start: number; voice: string; dur: number }> = [];
  const voiceCursor = new Map<string, number>();
  let lastNoteVoice = '1';
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'backup') {
      const v = timelineVoiceEl(child, lastNoteVoice);
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - timelineDurationEl(child)));
    } else if (tag === 'forward') {
      const v = timelineVoiceEl(child, lastNoteVoice);
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + timelineDurationEl(child));
    } else if (tag === 'note') {
      if (child.querySelector('chord, *|chord') !== null) continue;
      const voice = noteVoiceNumber(child);
      lastNoteVoice = voice;
      const start = voiceCursor.get(voice) ?? 0;
      leaders.push({ note: child, start, voice, dur: noteDurationValue(child) });
      voiceCursor.set(voice, start + noteDurationValue(child));
    }
  }

  const byStart = new Map<number, Array<{ note: Element; start: number; voice: string; dur: number }>>();
  for (const entry of leaders) {
    const list = byStart.get(entry.start) ?? [];
    list.push(entry);
    byStart.set(entry.start, list);
  }

  let changed = false;
  for (const group of byStart.values()) {
    const voices = [...new Set(group.map((g) => g.voice))];
    if (voices.length < 2) continue;
    if (!group.some((g) => voiceLeaderHadForwardPrefix(measure, g.note, g.voice))) continue;

    const targetVoice = [...voices].sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99))[0]!;
    const leaderEntry = [...group].sort(
      (a, b) => b.dur - a.dur || noteTypeWeight(b.note) - noteTypeWeight(a.note) || (parseInt(a.voice, 10) || 99) - (parseInt(b.voice, 10) || 99),
    )[0]!;
    const leaderNote = leaderEntry.note;

    const packed = group.map((entry) => ({
      entry,
      nodes: noteGroupWithChords(measure, entry.note),
    }));
    if (packed.some(({ nodes }) => nodes.some(noteHasBeamTag))) continue;
    for (const { entry } of packed) {
      if (entry.note !== leaderNote) removeForwardBeforeNote(measure, entry.note, entry.voice);
    }

    const mergedNodes = packed.flatMap((p) => p.nodes);
    const mergedSet = new Set(mergedNodes);
    const firstIdx = Math.min(...mergedNodes.map((n) => [...measure.children].indexOf(n)).filter((i) => i >= 0));
    if (firstIdx < 0) continue;
    let insertRef: Element | null = null;
    for (let i = firstIdx - 1; i >= 0; i -= 1) {
      const cand = measure.children[i]!;
      if (!mergedSet.has(cand)) {
        insertRef = cand;
        break;
      }
    }

    for (const n of mergedNodes) {
      if (n.parentNode === measure) measure.removeChild(n);
    }

    leaderNote.querySelector('chord, *|chord')?.remove();
    setNoteVoice(leaderNote, targetVoice);

    const chordMembers: Element[] = [];
    for (const { nodes } of packed) {
      for (const n of nodes) {
        if (n === leaderNote) continue;
        ensureChordTag(n);
        setNoteVoice(n, targetVoice);
        chordMembers.push(n);
      }
    }

    const insertBefore = insertRef ? insertRef.nextSibling : measure.firstChild;
    measure.insertBefore(leaderNote, insertBefore);
    let anchor: Element | null = leaderNote.nextSibling;
    for (const n of chordMembers) {
      measure.insertBefore(n, anchor);
    }
    changed = true;
  }

  if (changed) removeDanglingTimelineInMeasure(measure);
  return changed;
}

function collectStaffNoteOnsets(measure: Element): Map<Element, number> {
  const out = new Map<Element, number>();
  const voiceCursor = new Map<string, number>();
  let lastNoteVoice = '1';
  for (const el of [...measure.children]) {
    const tag = xmlLocalName(el);
    if (tag === 'backup') {
      const v = timelineVoiceEl(el, lastNoteVoice);
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - timelineDurationEl(el)));
    } else if (tag === 'forward') {
      const v = timelineVoiceEl(el, lastNoteVoice);
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + timelineDurationEl(el));
    } else if (tag === 'note') {
      if (el.querySelector('chord, *|chord') !== null) continue;
      const voice = noteVoiceNumber(el);
      lastNoteVoice = voice;
      out.set(el, voiceCursor.get(voice) ?? 0);
      voiceCursor.set(voice, (voiceCursor.get(voice) ?? 0) + noteDurationValue(el));
    }
  }
  return out;
}

/**
 * OSMD split-staff 미리보기 — `<forward>` 뒤에 더 이른 onset 음이 있으면
 * 해당 음(화음 그룹)만 forward 앞으로 이동(빔·저장 MXL 불변).
 */
export function reorderSingleStaffTimelineByOnsetForOsmdPreview(measure: Element): boolean {
  const onsets = collectStaffNoteOnsets(measure);
  const children = [...measure.children];
  let changed = false;

  for (let i = 0; i < children.length; i += 1) {
    const el = children[i]!;
    if (xmlLocalName(el) !== 'forward') continue;

    let anchorOnset = Number.POSITIVE_INFINITY;
    for (let j = i + 1; j < children.length; j += 1) {
      const next = children[j]!;
      if (xmlLocalName(next) !== 'note') continue;
      if (next.querySelector('chord, *|chord') !== null) continue;
      anchorOnset = onsets.get(next) ?? 0;
      break;
    }
    if (!Number.isFinite(anchorOnset)) continue;

    const groupsToMove: Element[][] = [];
    for (let j = i + 1; j < children.length; j += 1) {
      const next = children[j]!;
      if (xmlLocalName(next) !== 'note') continue;
      if (next.querySelector('chord, *|chord') !== null) continue;
      const start = onsets.get(next) ?? 0;
      if (start >= anchorOnset) continue;
      groupsToMove.push(noteGroupWithChords(measure, next));
    }
    if (groupsToMove.length === 0) continue;

    for (const group of groupsToMove) {
      for (const node of group) measure.removeChild(node);
    }
    for (const group of groupsToMove) {
      for (const node of group) measure.insertBefore(node, el);
    }
    changed = true;
    return reorderSingleStaffTimelineByOnsetForOsmdPreview(measure) || changed;
  }
  return changed;
}

type VoiceLayerBlock = { kind: 'forward' | 'note-group'; nodes: Element[] };

function collectVoiceLayerBlocks(measure: Element): Map<string, VoiceLayerBlock[]> {
  const byVoice = new Map<string, VoiceLayerBlock[]>();
  let lastVoice = '1';
  for (const el of [...measure.children]) {
    const tag = xmlLocalName(el);
    if (tag === 'backup') continue;
    if (tag === 'forward') {
      const v = timelineVoiceEl(el, lastVoice);
      const list = byVoice.get(v) ?? [];
      list.push({ kind: 'forward', nodes: [el] });
      byVoice.set(v, list);
      continue;
    }
    if (tag === 'note') {
      if (el.querySelector('chord, *|chord') !== null) continue;
      const v = noteVoiceNumber(el);
      lastVoice = v;
      const list = byVoice.get(v) ?? [];
      list.push({ kind: 'note-group', nodes: noteGroupWithChords(measure, el) });
      byVoice.set(v, list);
    }
  }
  return byVoice;
}

function voiceLayerBlocksDuration(blocks: VoiceLayerBlock[]): number {
  let cursor = 0;
  for (const block of blocks) {
    if (block.kind === 'forward') cursor += timelineDurationEl(block.nodes[0]!);
    else cursor += noteDurationValue(block.nodes[0]!);
  }
  return cursor;
}

function measureHasInterleavedVoices(measure: Element): boolean {
  const seenVoices = new Set<string>();
  let lastVoice = '1';
  for (const el of [...measure.children]) {
    const tag = xmlLocalName(el);
    if (tag === 'forward') {
      seenVoices.add(timelineVoiceEl(el, lastVoice));
      continue;
    }
    if (tag !== 'note' || el.querySelector('chord, *|chord') !== null) continue;
    const v = noteVoiceNumber(el);
    lastVoice = v;
    seenVoices.add(v);
    if (seenVoices.size < 2) continue;
    const voices = [...seenVoices].sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99));
    if (v !== voices[voices.length - 1]) return true;
  }
  return false;
}

/**
 * OSMD split-staff 미리보기 — interleaved voice를 MusicXML 관례( voice1 전체 → backup → voice2 … )로
 * 재배치해 동시 onset 음(F4·E5 등)이 같은 staff column에 그려지게 함(저장 MXL 불변).
 */
export function normalizeMultiVoiceLayersForOsmdPreview(measure: Element): boolean {
  if (!measureHasInterleavedVoices(measure)) return false;
  const byVoice = collectVoiceLayerBlocks(measure);
  const voices = [...byVoice.keys()].sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99));
  if (voices.length < 2) return false;

  const timelineTags = new Set(['note', 'backup', 'forward']);
  const detached: Element[] = [];
  for (const child of [...measure.children]) {
    if (!timelineTags.has(xmlLocalName(child))) continue;
    measure.removeChild(child);
    detached.push(child);
  }
  if (detached.length === 0) return false;

  let insertAt = 0;
  while (insertAt < measure.children.length) {
    const tag = xmlLocalName(measure.children[insertAt]!);
    if (tag === 'attributes' || tag === 'print' || tag === 'direction') insertAt += 1;
    else break;
  }

  const doc = measure.ownerDocument!;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const mk = (local: string) => (ns ? doc.createElementNS(ns, local) : doc.createElement(local));

  for (let vi = 0; vi < voices.length; vi += 1) {
    const voice = voices[vi]!;
    const blocks = byVoice.get(voice) ?? [];
    if (vi > 0) {
      const prevVoice = voices[vi - 1]!;
      const backupDur = voiceLayerBlocksDuration(byVoice.get(prevVoice) ?? []);
      if (backupDur > 0) {
        const backup = mk('backup');
        const durEl = mk('duration');
        durEl.textContent = String(backupDur);
        backup.appendChild(durEl);
        measure.insertBefore(backup, measure.children[insertAt] ?? null);
        insertAt += 1;
      }
    }
    for (const block of blocks) {
      for (const node of block.nodes) {
        node.querySelectorAll('staff, *|staff').forEach((st) => st.remove());
        measure.insertBefore(node, measure.children[insertAt] ?? null);
        insertAt += 1;
      }
    }
  }
  return true;
}

/**
 * OSMD/HITL 미리보기 전용 — Audiveris 절대 좌표 제거 후 voice timeline 시작 시점으로
 * `default-x` 재주입. 동시 시작(다른 voice·박자) 음이 같은 수평선에 그려지게 함.
 */
export function realignDefaultXFromStaffTimelineForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        realignMeasureDefaultXFromTimeline(measure);
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/**
 * OSMD/HITL 미리보기 전용 — `<backup>` 시간이 누적 cursor보다 커서 음수 시간이 생기는 버그 방지.
 * OMR 오류로 note duration 총합이 부족한 상태에서 전체 마디 길이에 맞춰 `<backup>`을 하면
 * OSMD에서 마디 렌더링이 통째로 스킵되는 문제(예: 26마디 실종)를 방지합니다.
 */
export function capBackupDurationsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        let cursor = 0;
        for (const child of Array.from(measure.children)) {
          const tag = xmlLocalName(child);
          if (tag === 'note') {
            const isChord = child.querySelector('chord, *|chord') !== null;
            const durationEl = child.querySelector('duration, *|duration');
            if (durationEl && !isChord) {
              const dur = parseInt(durationEl.textContent || '0', 10);
              if (!isNaN(dur)) cursor += dur;
            }
          } else if (tag === 'forward') {
            const durationEl = child.querySelector('duration, *|duration');
            if (durationEl) {
              const dur = parseInt(durationEl.textContent || '0', 10);
              if (!isNaN(dur)) cursor += dur;
            }
          } else if (tag === 'backup') {
            const durationEl = child.querySelector('duration, *|duration');
            if (durationEl) {
              const dur = parseInt(durationEl.textContent || '0', 10);
              if (!isNaN(dur)) {
                if (dur > cursor) {
                  durationEl.textContent = cursor.toString();
                  cursor = 0;
                } else {
                  cursor -= dur;
                }
              }
            }
          }
        }
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}
