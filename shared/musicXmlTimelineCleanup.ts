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
    if (!hasNoteAfter(measure, idx) || !hasNoteBefore(measure, idx)) {
      child.remove();
    }
  }
}

/** OSMD/HITL 미리보기 전용 — dangling timeline + 페이지·시스템 나눔 print 정리(저장 MXL 불변). */
export function repairTimelineForOsmdPreview(xml: string): string {
  let out = removeDanglingTimelineElementsForOsmdPreview(xml);
  out = stripPageBreakPrintForOsmdPreview(out);
  out = stripNewSystemPrintForOsmdPreview(out);
  return out;
}

/**
 * OSMD/HITL 미리보기 전용 — `<print new-page="yes">` 제거(연속 스크롤 레이아웃).
 * 페이지 직후 마디(예: 5쪽→26마디)가 OSMD에서 화면 밖·0폭으로 그려지는 경우 방지.
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
 * 페이지 직후(25→26) + 새 시스템(27) 조합에서 OSMD가 26마디 칸을 비우거나 27 내용을 당겨 그리는 경우 방지.
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
          if (!hasNoteAfter(measure, i) || !hasNoteBefore(measure, i)) n += 1;
        }
      }
    }
    return n;
  } catch {
    return 0;
  }
}
