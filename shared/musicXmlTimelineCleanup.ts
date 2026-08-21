import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
import {
  applyPreviewOnsetSlotLayoutToMeasure,
  applyPreviewOnsetSlotLayoutToXml,
  OSMD_LAYOUT_X_ATTR,
} from './musicXmlPreviewOnsetLayout';
import {
  applyPlayOrderLayoutToMeasure,
  applyPlayOrderLayoutToXml,
} from './musicXmlPlayOrder';

const OSMD_ORIG_DEFAULT_X_ATTR = 'data-osmd-orig-default-x';

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
  out = dedupeIdenticalChordPitchesForOsmdPreview(out);
  out = normalizeSlursForOsmdPreview(out);
  return out;
}

/**
 * OSMD/HITL 미리보기 전용 — slur 좌표/고아 stop 정리 및 number 정리.
 * Audiveris raw bezier/default-y 좌표 및 끊어진 고아 stop 제거.
 * 같은 음에 start/stop이 여러 개면 **좌표(bezier·default-x/y) 없는 쪽**을 남긴다.
 * stop은 같은 staff+number의 open start에만 짝짓는다(고아 stop이 긴 이음줄을 가로채지 않음).
 * start number는 가능하면 유지하고, 충돌 시에만 재번호화하며 짝 stop도 remap.
 * 같은 마디에서 stop 직후 number를 재사용하지 않는다 — PR/PL이 시간상 겹치면 OSMD가
 * 같은 number의 start/stop을 잘못 짝지어 한쪽 이음줄이 안 보인다.
 */
export function normalizeSlursForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;

    const slurLayoutNoise = (s: Element): number =>
      (['bezier-x', 'bezier-y', 'default-x', 'default-y'] as const).filter((a) => s.hasAttribute(a))
        .length;

    const pickPreferredSlur = (list: Element[]): Element => {
      let best = list[0]!;
      let bestNoise = slurLayoutNoise(best);
      for (let i = 1; i < list.length; i += 1) {
        const cand = list[i]!;
        const n = slurLayoutNoise(cand);
        if (n < bestNoise) {
          best = cand;
          bestNoise = n;
        }
      }
      return best;
    };

    for (const part of findXmlParts(doc)) {
      const openSlurs = new Map<string, { staff: string; voice: string; measureNum: string }>();

      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        const mnum = measure.getAttribute('number') || '';
        const usedNumsInMeasure = new Set<string>(openSlurs.keys());
        const stopNumRemap = new Map<string, string>(); // `${staff}|${orig}` -> newNum

        for (const note of [...measure.children]) {
          if (xmlLocalName(note) !== 'note') continue;
          const notations = [...note.children].find((c) => xmlLocalName(c) === 'notations');
          if (!notations) continue;

          const staff =
            [...note.children].find((c) => xmlLocalName(c) === 'staff')?.textContent?.trim() || '1';
          const voice =
            [...note.children].find((c) => xmlLocalName(c) === 'voice')?.textContent?.trim() || '1';

          let slurs = [...notations.children].filter((c) => xmlLocalName(c) === 'slur');
          if (slurs.length === 0) continue;

          let starts = slurs.filter((s) => s.getAttribute('type') === 'start');
          let stops = slurs.filter((s) => s.getAttribute('type') === 'stop');

          if (starts.length > 1) {
            const keep = pickPreferredSlur(starts);
            for (const s of starts) {
              if (s !== keep) s.remove();
            }
            starts = [keep];
          }

          if (stops.length > 1) {
            const keep = pickPreferredSlur(stops);
            for (const s of stops) {
              if (s !== keep) s.remove();
            }
            stops = [keep];
          }

          slurs = [...notations.children].filter((c) => xmlLocalName(c) === 'slur');

          for (const s of slurs) {
            s.removeAttribute('bezier-x');
            s.removeAttribute('bezier-y');
            s.removeAttribute('default-x');
            s.removeAttribute('default-y');
          }

          starts = slurs.filter((s) => s.getAttribute('type') === 'start');
          stops = slurs.filter((s) => s.getAttribute('type') === 'stop');

          for (const s of stops) {
            const origNum = (s.getAttribute('number') || '1').trim() || '1';
            const remapKey = `${staff}|${origNum}`;
            const lookup = stopNumRemap.get(remapKey) || origNum;
            let matchedNum: string | null = null;
            if (openSlurs.has(lookup) && openSlurs.get(lookup)!.staff === staff) {
              matchedNum = lookup;
            } else if (openSlurs.has(origNum) && openSlurs.get(origNum)!.staff === staff) {
              matchedNum = origNum;
            }
            if (matchedNum != null) {
              if ((s.getAttribute('number') || '') !== matchedNum) {
                s.setAttribute('number', matchedNum);
              }
              openSlurs.delete(matchedNum);
              usedNumsInMeasure.add(matchedNum);
            } else {
              s.remove();
            }
          }

          for (const s of starts) {
            const origNum = (s.getAttribute('number') || '1').trim() || '1';
            let num = origNum;
            if (openSlurs.has(num) || usedNumsInMeasure.has(num)) {
              let nextNum = 1;
              while (openSlurs.has(String(nextNum)) || usedNumsInMeasure.has(String(nextNum))) {
                nextNum += 1;
              }
              num = String(nextNum);
            }
            if ((s.getAttribute('number') || '') !== num) {
              s.setAttribute('number', num);
              if (origNum !== num) stopNumRemap.set(`${staff}|${origNum}`, num);
            }
            openSlurs.set(num, {
              staff,
              voice,
              measureNum: mnum,
            });
          }

          if (notations.children.length === 0) {
            notations.remove();
          }
        }
      }
    }

    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
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
    doc.querySelectorAll('note, *|note').forEach((el) => {
      const x = el.getAttribute('default-x')?.trim();
      if (x && !el.getAttribute(OSMD_ORIG_DEFAULT_X_ATTR)) {
        el.setAttribute(OSMD_ORIG_DEFAULT_X_ATTR, x);
      }
      el.removeAttribute('default-x');
      el.removeAttribute('default-y');
    });
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/**
 * OSMD load 직전 — 미리보기 layout이 다시 넣은 `default-x`를 제거하되
 * SVG align용 `data-osmd-layout-x`·연주순번·onset attr은 유지.
 * (default-x를 OSMD에 넘기면 0폭·음표 소실이 재발할 수 있음)
 */
export function stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    doc.querySelectorAll('note, *|note').forEach((el) => {
      const layout =
        el.getAttribute(OSMD_LAYOUT_X_ATTR)?.trim() ||
        el.getAttribute('default-x')?.trim() ||
        '';
      if (layout) {
        el.setAttribute(OSMD_LAYOUT_X_ATTR, layout);
        // onset 비율(32..432) — OSMD spacing. Audiveris 원본 default-x는 repair 단계에서 제거됨.
        el.setAttribute('default-x', layout);
      } else {
        el.removeAttribute('default-x');
      }
      el.removeAttribute('default-y');
    });
    doc.querySelectorAll('direction, *|direction').forEach((el) => {
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

function notePitchKeyForChordDedupe(note: Element): string | null {
  const pitch = note.querySelector(':scope > pitch, :scope > *|pitch');
  if (!pitch) return null;
  const step = pitch.querySelector(':scope > step, :scope > *|step')?.textContent?.trim() ?? '';
  const oct = pitch.querySelector(':scope > octave, :scope > *|octave')?.textContent?.trim() ?? '';
  const alter = pitch.querySelector(':scope > alter, :scope > *|alter')?.textContent?.trim() ?? '0';
  if (!step || !oct) return null;
  return `${step}|${oct}|${alter}`;
}

/**
 * OSMD/HITL 미리보기 전용 — 한 화음 그룹에 같은 피치가 두 번 있으면 뒤 멤버를 뺀다.
 * OMR이 유니즌을 중복 `<chord/>`로 넣으면 같은 머리가 두 번 그려진다. 저장 MXL은 HITL 조회·반영에서 정리.
 */
export function dedupeIdenticalChordPitchesForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        let groupKeys = new Set<string>();
        for (const child of [...measure.children]) {
          if (xmlLocalName(child) !== 'note') {
            groupKeys = new Set();
            continue;
          }
          const isChord = child.querySelector(':scope > chord, :scope > *|chord') != null;
          if (!isChord) {
            groupKeys = new Set();
            const k = notePitchKeyForChordDedupe(child);
            if (k) groupKeys.add(k);
            continue;
          }
          const k = notePitchKeyForChordDedupe(child);
          if (k && groupKeys.has(k)) child.remove();
          else if (k) groupKeys.add(k);
        }
      }
    }
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

/** 단일 staff 필터 후 note staff 태그가 없으면 이미 해당 staff만 남음. */
function noteMatchesPreviewStaff(note: Element, staffN: number): boolean {
  const st = note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim();
  if (!st) return true;
  return noteStaffNumber(note) === staffN;
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

function realignMeasureDefaultXFromTimeline(measure: Element): void {
  applyPlayOrderLayoutToMeasure(measure);
}

/** 단일 마디 OSMD 미리보기 — onset slot·lyric slot·default-x 재주입. */
export function realignMeasureDefaultXFromTimelineForOsmd(measure: Element): void {
  realignMeasureDefaultXFromTimeline(measure);
}

/** reorder·layer 정규화 전 MXL default-x 보존 — linkParallel(동일 x) vs 자연 다성부(미세히 다른 x) 구분. */
export function snapshotNoteDefaultXForOsmdPreview(measure: Element): void {
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (child.getAttribute(OSMD_ORIG_DEFAULT_X_ATTR)) continue;
    const x = child.getAttribute('default-x')?.trim();
    if (x) child.setAttribute(OSMD_ORIG_DEFAULT_X_ATTR, x);
  }
}

export function stripNoteDefaultXSnapshotsForOsmdPreview(measure: Element): void {
  measure.querySelectorAll(`note[${OSMD_ORIG_DEFAULT_X_ATTR}], note *|note[${OSMD_ORIG_DEFAULT_X_ATTR}]`).forEach((el) => {
    el.removeAttribute(OSMD_ORIG_DEFAULT_X_ATTR);
  });
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note') child.removeAttribute(OSMD_ORIG_DEFAULT_X_ATTR);
  }
}

function noteOrigDefaultX(note: Element): string | null {
  return note.getAttribute(OSMD_ORIG_DEFAULT_X_ATTR)?.trim() ?? note.getAttribute('default-x')?.trim() ?? null;
}

function defaultXValuesEqual(a: string, b: string): boolean {
  const na = Number.parseFloat(a);
  const nb = Number.parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 0.01;
  return a === b;
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

/** print·attributes·선두 direction 뒤에 오는가 — 첫 note 앞 header. */
export function isMeasureHeaderChild(measure: Element, el: Element): boolean {
  for (const c of [...measure.children]) {
    if (c === el) return true;
    const tag = xmlLocalName(c);
    if (tag === 'print' || tag === 'attributes' || tag === 'direction') continue;
    return false;
  }
  return false;
}

/** 첫 note 앞이 아닌, 해당 음 바로 앞의 mid-measure `<direction>` (wedge stop 등). */
export function leadingDirectionsBeforeNote(measure: Element, note: Element): Element[] {
  const children = [...measure.children];
  const idx = children.indexOf(note);
  if (idx < 0) return [];
  const out: Element[] = [];
  for (let i = idx - 1; i >= 0; i -= 1) {
    const el = children[i]!;
    if (xmlLocalName(el) !== 'direction') break;
    if (isMeasureHeaderChild(measure, el)) break;
    out.unshift(el);
  }
  return out;
}

/** 화음 그룹 바로 뒤 trailing direction (wedge stop을 마지막 음 뒤에 둔 경우). */
export function trailingDirectionsAfterNoteGroup(measure: Element, leader: Element): Element[] {
  const group = noteGroupWithChords(measure, leader);
  const last = group[group.length - 1];
  if (!last) return [];
  const children = [...measure.children];
  const idx = children.indexOf(last);
  if (idx < 0) return [];
  const out: Element[] = [];
  for (let i = idx + 1; i < children.length; i += 1) {
    const el = children[i]!;
    if (xmlLocalName(el) !== 'direction') break;
    out.push(el);
  }
  return out;
}

export function lastRhythmicNoteInMeasure(measure: Element): Element | null {
  let last: Element | null = null;
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (child.querySelector(':scope > chord, :scope > *|chord')) continue;
    last = child;
  }
  return last;
}

function directionWedgeType(dir: Element): string | null {
  for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
    for (const w of [...dt.children].filter((c) => xmlLocalName(c) === 'wedge')) {
      const t = (w.getAttribute('type') || '').trim().toLowerCase();
      if (t) return t;
    }
  }
  return null;
}

function directionStaffNumber(dir: Element): number {
  const st = dir.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim();
  return st && /^\d+$/.test(st) ? parseInt(st, 10) : 1;
}

function firstRhythmicNoteOnStaff(measure: Element, staffN: number): Element | null {
  for (const c of [...measure.children]) {
    if (xmlLocalName(c) !== 'note') continue;
    if (c.querySelector(':scope > chord, :scope > *|chord')) continue;
    if (!noteMatchesPreviewStaff(c, staffN)) continue;
    return c;
  }
  return null;
}

function lastRhythmicNoteOnStaff(measure: Element, staffN: number): Element | null {
  let last: Element | null = null;
  for (const c of [...measure.children]) {
    if (xmlLocalName(c) !== 'note') continue;
    if (c.querySelector(':scope > chord, :scope > *|chord')) continue;
    if (!noteMatchesPreviewStaff(c, staffN)) continue;
    last = c;
  }
  return last;
}

function insertDirectionAfterNoteGroup(measure: Element, direction: Element, leader: Element): void {
  const group = noteGroupWithChords(measure, leader);
  const last = group[group.length - 1] ?? leader;
  direction.remove();
  const after = last.nextElementSibling;
  if (after) measure.insertBefore(direction, after);
  else measure.appendChild(direction);
}

/**
 * OSMD: 마디 처음(첫 음 앞)이나 barline에 있는 wedge stop은 다음 마디 t=0으로 붙어
 * 닫히지 않은 점선이 다음 마디 끝까지 이어진다. 그 경우만 해당 staff 마지막 음 뒤로 옮긴다.
 *
 * 이미 같은 staff 음표 **뒤**(backup/forward 직전이어도)에 있는 stop은 옮기지 않는다.
 * (PL A2→E2 stop을 E4 뒤로 옮기면 start보다 앞에 가 OSMD가 점선을 안 그림.)
 */
export function reanchorWedgeStopsForOsmdPreview(measure: Element, staffN: number): void {
  const last = lastRhythmicNoteOnStaff(measure, staffN);
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'direction') continue;
    if (directionWedgeType(child) !== 'stop') continue;
    if (directionStaffNumber(child) !== staffN) continue;
    const children = [...measure.children];
    const idx = children.indexOf(child);
    if (idx < 0) continue;

    let hasPrevNoteOnStaff = false;
    for (let j = idx - 1; j >= 0; j -= 1) {
      const c = children[j]!;
      if (xmlLocalName(c) !== 'note') continue;
      if (c.querySelector(':scope > chord, :scope > *|chord')) continue;
      if (noteMatchesPreviewStaff(c, staffN)) {
        hasPrevNoteOnStaff = true;
        break;
      }
    }
    // 이미 해당 staff 음 뒤에 있으면 유지 (backup 앞 stop 포함)
    if (hasPrevNoteOnStaff) continue;

    // 첫 음보다 앞·고아 stop → 해당 staff 마지막 음 뒤로
    if (last) insertDirectionAfterNoteGroup(measure, child, last);
    else child.remove();
  }
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

/** linkParallelOnsets — 선택 음들이 저장 MXL에서 같은 default-x로 맞춰진 경우만 (m16 자연 다성부 제외). */
function leadersShareLinkedParallelX(
  group: Array<{ note: Element; start: number; voice: string; dur: number }>,
): boolean {
  const xs = group.map((g) => noteOrigDefaultX(g.note)).filter((x): x is string => !!x);
  if (xs.length < group.length) return false;
  const first = xs[0]!;
  return xs.every((x) => defaultXValuesEqual(x, first));
}

/**
 * OSMD 미리보기 — linkParallelOnsets(같은 default-x) + forward 맞춘 동시 onset을
 * **긴 duration leader + chord** 로 한 column에 그림. VoiceSpacing 0 불필요.
 * m16(E5 x=70, F4 x=69) 등 x가 다른 자연 다성부는 merge 안 함.
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
    if (!leadersShareLinkedParallelX(group)) continue;

    const targetVoice = [...voices].sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99))[0]!;
    const leaderEntry = [...group].sort(
      (a, b) => b.dur - a.dur || noteTypeWeight(b.note) - noteTypeWeight(a.note) || (parseInt(a.voice, 10) || 99) - (parseInt(b.voice, 10) || 99),
    )[0]!;
    const leaderNote = leaderEntry.note;

    const packed = group.map((entry) => ({
      entry,
      nodes: noteGroupWithChords(measure, entry.note),
    }));
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
  stripNoteDefaultXSnapshotsForOsmdPreview(measure);
  return changed;
}

export type LinkedParallelOnsetHint = {
  /** MusicXML part id (미리보기 XML 기준 — split 시 P5__PR 등) */
  partId: string;
  measureNumber: number;
  /** voice timeline onset (divisions) */
  onset: number;
  /** part `<divisions>` when hint was collected */
  divisions: number;
  /** measure length in the same divisions units — OSMD timestamp = onset / measureLength */
  measureLength: number;
  anchorVoice: string;
  memberVoices: string[];
  /** linkParallel 선택 음 pitch — chord 멤버 포함(F4·Bb4·E5 등) */
  memberPitches: string[];
  anchorPitch: string;
};

export function xmlPitchLabelForOsmdPreview(note: Element): string {
  const step = note.querySelector('step, *|step')?.textContent?.trim() ?? '';
  const alter = note.querySelector('alter, *|alter')?.textContent?.trim();
  const oct = note.querySelector('octave, *|octave')?.textContent?.trim() ?? '';
  const acc = alter === '-1' ? 'b' : alter === '1' ? '#' : '';
  return `${step}${acc}${oct}`;
}

function collectParallelOnsetLeaders(measure: Element): Array<{ note: Element; start: number; voice: string; dur: number }> {
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
  return leaders;
}

/** linkParallelOnsets 미리보기 — XML 구조·beam·duration 유지, OSMD 그래픽 정렬 힌트만 수집. */
export function collectLinkedParallelOnsetHintsFromMeasure(
  partId: string,
  measure: Element,
  divisions: number,
  measureLength: number,
): LinkedParallelOnsetHint[] {
  const measureNumber = parseInt(measure.getAttribute('number') ?? '0', 10);
  if (!Number.isFinite(measureNumber) || measureNumber <= 0) return [];

  const leaders = collectParallelOnsetLeaders(measure);
  const byStart = new Map<number, Array<{ note: Element; start: number; voice: string; dur: number }>>();
  for (const entry of leaders) {
    const list = byStart.get(entry.start) ?? [];
    list.push(entry);
    byStart.set(entry.start, list);
  }

  const hints: LinkedParallelOnsetHint[] = [];
  for (const group of byStart.values()) {
    const voices = [...new Set(group.map((g) => g.voice))];
    if (voices.length < 2) continue;
    if (!group.some((g) => voiceLeaderHadForwardPrefix(measure, g.note, g.voice))) continue;
    if (!leadersShareLinkedParallelX(group)) continue;

    const anchorEntry = [...group].sort((a, b) => {
      const ax = Number.parseFloat(noteOrigDefaultX(a.note) ?? '999999');
      const bx = Number.parseFloat(noteOrigDefaultX(b.note) ?? '999999');
      return ax - bx || a.dur - b.dur;
    })[0]!;
    const memberPitches: string[] = [];
    for (const entry of group) {
      for (const n of noteGroupWithChords(measure, entry.note)) {
        memberPitches.push(xmlPitchLabelForOsmdPreview(n));
      }
    }
    hints.push({
      partId,
      measureNumber,
      onset: anchorEntry.start,
      divisions: Math.max(1, divisions),
      measureLength: Math.max(1, measureLength),
      anchorVoice: anchorEntry.voice,
      memberVoices: voices,
      memberPitches: [...new Set(memberPitches)],
      anchorPitch: xmlPitchLabelForOsmdPreview(anchorEntry.note),
    });
  }
  return hints;
}

export function collectLinkedParallelOnsetHintsFromXml(xml: string): LinkedParallelOnsetHint[] {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return [];
    const hints: LinkedParallelOnsetHint[] = [];
    for (const part of findXmlParts(doc)) {
      const partId = part.getAttribute('id')?.trim() ?? '';
      let divisions = 4;
      let beats = 4;
      let beatType = 4;
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        for (const child of [...measure.children]) {
          if (xmlLocalName(child) !== 'attributes') continue;
          const divEl = child.querySelector('divisions, *|divisions');
          const parsed = parseInt(divEl?.textContent?.trim() ?? '', 10);
          if (Number.isFinite(parsed) && parsed > 0) divisions = parsed;
          const timeEl = child.querySelector('time, *|time');
          if (timeEl) {
            const bEl = timeEl.querySelector('beats, *|beats');
            const btEl = timeEl.querySelector('beat-type, *|beat-type');
            const b = parseInt(bEl?.textContent?.trim() ?? '', 10);
            const bt = parseInt(btEl?.textContent?.trim() ?? '', 10);
            if (Number.isFinite(b) && b > 0) beats = b;
            if (Number.isFinite(bt) && bt > 0) beatType = bt;
          }
        }
        const measureLength = Math.max(1, Math.round((divisions * beats * 4) / beatType));
        hints.push(...collectLinkedParallelOnsetHintsFromMeasure(partId, measure, divisions, measureLength));
      }
    }
    return hints;
  } catch {
    return [];
  }
}

/** leader → part timeline onset(divisions). MusicXML backup/forward = 단일 cursor. */
export function collectStaffNoteOnsets(measure: Element): Map<Element, number> {
  const out = new Map<Element, number>();
  let cursor = 0;
  for (const el of [...measure.children]) {
    const tag = xmlLocalName(el);
    if (tag === 'backup') {
      cursor = Math.max(0, cursor - timelineDurationEl(el));
    } else if (tag === 'forward') {
      cursor += timelineDurationEl(el);
    } else if (tag === 'note') {
      if (el.querySelector('chord, *|chord') !== null) continue;
      out.set(el, cursor);
      cursor += noteDurationValue(el);
    }
  }
  return out;
}

/**
 * leader → voice-parallel onset(divisions). HITL 연주순번 sanitize·default PO용.
 * 같은 musical 동시성(E5·F4)을 단일 part cursor 손상 시에도 맞춘다.
 */
export function collectVoiceParallelNoteOnsets(measure: Element): Map<Element, number> {
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
      const start = voiceCursor.get(voice) ?? 0;
      out.set(el, start);
      voiceCursor.set(voice, start + noteDurationValue(el));
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

function nextNoteVoiceAfter(measureChildren: Element[], fromIdx: number, fallback: string): string {
  for (let j = fromIdx + 1; j < measureChildren.length; j += 1) {
    const el = measureChildren[j]!;
    if (xmlLocalName(el) !== 'note') continue;
    if (el.querySelector('chord, *|chord') !== null) continue;
    return noteVoiceNumber(el);
  }
  return fallback;
}

/** forward의 voice가 뒤쪽 음표에 없으면(성부 coalesce 잔재) 다음 음 성부로 재지정. */
function resolveForwardVoice(
  measureChildren: Element[],
  fromIdx: number,
  lastVoice: string,
): string {
  const el = measureChildren[fromIdx]!;
  const explicit = el.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
  const nextV = nextNoteVoiceAfter(measureChildren, fromIdx, lastVoice);
  if (!explicit) return nextV;
  for (let j = fromIdx + 1; j < measureChildren.length; j += 1) {
    const n = measureChildren[j]!;
    if (xmlLocalName(n) !== 'note') continue;
    if (n.querySelector('chord, *|chord') !== null) continue;
    if (noteVoiceNumber(n) === explicit) return explicit;
  }
  return nextV;
}

function voiceLayerHasPitchedNote(blocks: VoiceLayerBlock[]): boolean {
  for (const block of blocks) {
    if (block.kind !== 'note-group') continue;
    for (const node of block.nodes) {
      if (xmlLocalName(node) !== 'note') continue;
      if (node.querySelector('rest, *|rest')) continue;
      if (node.querySelector('pitch, *|pitch')) return true;
    }
  }
  return false;
}

/**
 * backup 전/후로 나눠 성부 블록을 모은다.
 * MusicXML에서 backup 뒤 voice 없는 `<forward>`는 **다음 음표 성부**의 onset 지연이다
 * (직전 성부에 붙이면 PL 이음줄·박자가 깨짐).
 * 같은 voice가 backup 앞(쉼표만)과 뒤(실음)에 모두 있으면 앞쪽을 버린다
 * (성부 번호 coalesce 후 REST+멜로디가 같은 voice로 겹치는 경우).
 */
function collectVoiceLayerBlocks(measure: Element): Map<string, VoiceLayerBlock[]> {
  const children = [...measure.children];
  const trailingByLeader = new Map<Element, Element[]>();
  const claimedTrailing = new Set<Element>();
  for (const el of children) {
    if (xmlLocalName(el) !== 'note') continue;
    if (el.querySelector('chord, *|chord') !== null) continue;
    let trailing = trailingDirectionsAfterNoteGroup(measure, el);
    // 쉼표 뒤 crescendo/diminuendo start는 다음 실음의 leading으로 둔다
    // (REST trailing으로 붙었다가 backup 앞 voice drop 시 wedge가 사라지거나 앞으로 밀림)
    if (el.querySelector('rest, *|rest')) {
      trailing = trailing.filter((d) => {
        const wt = directionWedgeType(d);
        return !wt || wt === 'stop';
      });
    }
    trailingByLeader.set(el, trailing);
    for (const d of trailing) claimedTrailing.add(d);
  }

  const beforeBackup = new Map<string, VoiceLayerBlock[]>();
  const afterBackup = new Map<string, VoiceLayerBlock[]>();
  let passedBackup = false;
  let lastVoice = '1';

  const push = (voice: string, block: VoiceLayerBlock) => {
    const map = passedBackup ? afterBackup : beforeBackup;
    const list = map.get(voice) ?? [];
    list.push(block);
    map.set(voice, list);
  };

  for (let i = 0; i < children.length; i += 1) {
    const el = children[i]!;
    const tag = xmlLocalName(el);
    if (tag === 'backup') {
      passedBackup = true;
      continue;
    }
    if (tag === 'forward') {
      const v = resolveForwardVoice(children, i, lastVoice);
      const voiceEl = el.querySelector(':scope > voice, :scope > *|voice');
      if (voiceEl) voiceEl.textContent = v;
      else {
        const doc = el.ownerDocument!;
        const ns = el.namespaceURI || 'http://www.musicxml.org/ns/partwise';
        const created = ns ? doc.createElementNS(ns, 'voice') : doc.createElement('voice');
        created.textContent = v;
        el.appendChild(created);
      }
      push(v, { kind: 'forward', nodes: [el] });
      continue;
    }
    if (tag === 'note') {
      if (el.querySelector('chord, *|chord') !== null) continue;
      const v = noteVoiceNumber(el);
      lastVoice = v;
      const leading = leadingDirectionsBeforeNote(measure, el).filter((d) => !claimedTrailing.has(d));
      push(v, {
        kind: 'note-group',
        nodes: [...leading, ...noteGroupWithChords(measure, el), ...(trailingByLeader.get(el) ?? [])],
      });
    }
  }

  const voices = new Set<string>([...beforeBackup.keys(), ...afterBackup.keys()]);
  const byVoice = new Map<string, VoiceLayerBlock[]>();
  for (const voice of voices) {
    const before = beforeBackup.get(voice) ?? [];
    const after = afterBackup.get(voice) ?? [];
    if (after.length > 0 && voiceLayerHasPitchedNote(after) && before.length > 0) {
      // backup 뒤 실음이 있으면 앞쪽 같은 voice(대개 스퓨리어스 REST)는 버린다
      byVoice.set(voice, after);
    } else if (before.length && after.length) {
      byVoice.set(voice, [...before, ...after]);
    } else if (after.length) {
      byVoice.set(voice, after);
    } else {
      byVoice.set(voice, before);
    }
  }
  if (typeof process !== 'undefined' && process.env.DEBUG_VOICE_LAYERS === '1') {
    const summarize = (blocks: VoiceLayerBlock[]) =>
      blocks
        .map((b) => {
          if (b.kind === 'forward') return `fwd(${timelineDurationEl(b.nodes[0]!)})`;
          const n = b.nodes.find((x) => xmlLocalName(x) === 'note');
          if (!n) return 'grp?';
          if (n.querySelector('rest, *|rest')) return 'REST';
          return (
            (n.querySelector('step, *|step')?.textContent || '?') +
            (n.querySelector('octave, *|octave')?.textContent || '')
          );
        })
        .join(',');
    console.error(
      'VOICE_LAYERS',
      [...byVoice.entries()].map(([v, b]) => `v${v}=[${summarize(b)}]`).join(' | '),
    );
  }
  return byVoice;
}

function voiceLayerBlocksDuration(blocks: VoiceLayerBlock[]): number {
  let cursor = 0;
  for (const block of blocks) {
    if (block.kind === 'forward') cursor += timelineDurationEl(block.nodes[0]!);
    else {
      const note = block.nodes.find((n) => xmlLocalName(n) === 'note');
      if (note) cursor += noteDurationValue(note);
    }
  }
  return cursor;
}

function measureHasInterleavedVoices(measure: Element): boolean {
  const children = [...measure.children];
  const seenVoices = new Set<string>();
  let lastVoice = '1';
  for (let i = 0; i < children.length; i += 1) {
    const el = children[i]!;
    const tag = xmlLocalName(el);
    if (tag === 'forward') {
      seenVoices.add(resolveForwardVoice(children, i, lastVoice));
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
 * backup 뒤 voice 없는 forward는 다음 음 성부에 붙이고, backup 앞·뒤에 같은 voice가
 * 겹치면(성부 coalesce 후 REST+멜로디) 앞쪽을 버려 이음줄·박자 붕괴를 막는다.
 */
export function normalizeMultiVoiceLayersForOsmdPreview(measure: Element): boolean {
  if (!measureHasInterleavedVoices(measure)) return false;
  const byVoice = collectVoiceLayerBlocks(measure);
  const voices = [...byVoice.keys()].sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99));
  if (voices.length < 2) return false;

  const gluedDirs = new Set<Element>();
  for (const blocks of byVoice.values()) {
    for (const block of blocks) {
      for (const node of block.nodes) {
        if (xmlLocalName(node) === 'direction') gluedDirs.add(node);
      }
    }
  }

  const timelineTags = new Set(['note', 'backup', 'forward']);
  const detached: Element[] = [];
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (!timelineTags.has(tag) && !gluedDirs.has(child)) continue;
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
        // note만 staff 제거 — direction staff를 지우면 이후 reattach가 PL wedge를 삭제함
        if (xmlLocalName(node) === 'note') {
          node.querySelectorAll('staff, *|staff').forEach((st) => st.remove());
        }
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
  return applyPlayOrderLayoutToXml(xml);
}

/**
 * OSMD/HITL 미리보기 전용 — 마디 박자 초과(Overfull Measure / Overflow) 및 음수 타임라인 방지.
 * 1. 각 성부(voice)의 누적 duration 및 `<forward>`가 마디 기준 박자(예: 4/4 = divisions * 4)를 초과할 경우
 *    마디 끝으로 clamp하여 음표가 다음 마디로 밀려나 렌더링되는 문제를 방지합니다.
 * 2. `<backup>`이 누적 cursor보다 커서 음수 시간이 생기거나 마디 렌더링이 스킵되는 버그를 방지합니다.
 */
export function capBackupDurationsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      let divisions = 1;
      let beats = 4;
      let beatType = 4;
      for (const measure of [...part.children]) {
        if (xmlLocalName(measure) !== 'measure') continue;
        for (const child of [...measure.children]) {
          if (xmlLocalName(child) !== 'attributes') continue;
          const divEl = child.querySelector('divisions, *|divisions');
          const parsedDiv = parseInt(divEl?.textContent?.trim() ?? '', 10);
          if (Number.isFinite(parsedDiv) && parsedDiv > 0) divisions = parsedDiv;
          const timeEl = child.querySelector('time, *|time');
          if (timeEl) {
            const bEl = timeEl.querySelector('beats, *|beats');
            const btEl = timeEl.querySelector('beat-type, *|beat-type');
            const b = parseInt(bEl?.textContent?.trim() ?? '', 10);
            const bt = parseInt(btEl?.textContent?.trim() ?? '', 10);
            if (Number.isFinite(b) && b > 0) beats = b;
            if (Number.isFinite(bt) && bt > 0) beatType = bt;
          }
        }
        const capacity = Math.max(1, Math.round((divisions * beats * 4) / beatType));
        let cursor = 0;
        let lastLeaderCapped = false;
        let lastLeaderDur = 0;
        for (const child of Array.from(measure.children)) {
          const tag = xmlLocalName(child);
          if (tag === 'note') {
            const isChord = child.querySelector('chord, *|chord') !== null;
            const isGrace = child.querySelector('grace, *|grace') !== null;
            const durationEl = child.querySelector('duration, *|duration');
            if (isChord) {
              if (lastLeaderCapped && durationEl) {
                durationEl.textContent = String(lastLeaderDur);
              }
            } else if (!isGrace) {
              lastLeaderCapped = false;
              lastLeaderDur = 0;
              if (durationEl) {
                const dur = parseInt(durationEl.textContent || '0', 10);
                if (!isNaN(dur) && dur > 0) {
                  if (cursor + dur > capacity) {
                    const cappedDur = Math.max(1, capacity - cursor);
                    durationEl.textContent = String(cappedDur);
                    lastLeaderCapped = true;
                    lastLeaderDur = cappedDur;
                    cursor = capacity;
                  } else {
                    cursor += dur;
                  }
                }
              }
            }
          } else if (tag === 'forward') {
            lastLeaderCapped = false;
            lastLeaderDur = 0;
            const durationEl = child.querySelector('duration, *|duration');
            if (durationEl) {
              const dur = parseInt(durationEl.textContent || '0', 10);
              if (!isNaN(dur) && dur > 0) {
                if (cursor >= capacity) {
                  child.remove();
                } else if (cursor + dur > capacity) {
                  const cappedDur = capacity - cursor;
                  if (cappedDur <= 0) {
                    child.remove();
                  } else {
                    durationEl.textContent = String(cappedDur);
                    cursor = capacity;
                  }
                } else {
                  cursor += dur;
                }
              }
            }
          } else if (tag === 'backup') {
            lastLeaderCapped = false;
            lastLeaderDur = 0;
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
