import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
import { inferFirstMxlMeasureForPdfPage } from './musicXmlTimelineCleanup';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function findXmlParts(doc: Document): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    if (xmlLocalName(el) === 'part') out.push(el);
    for (const c of [...el.children]) walk(c);
  };
  if (doc.documentElement) walk(doc.documentElement);
  return out;
}

function parseMeasureNumber(measure: Element): number | null {
  const n = parseInt(measure.getAttribute('number') ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** PDF 페이지 ↔ MXL 마디 — rawXml당 1회 파싱 결과를 재사용 (페이지 넘김 시 DOM 재파싱 금지). */
export type PdfPageMeasureIndex = {
  /** pageStarts[i] = PDF (i+1)페이지 첫 measure@number */
  pageStarts: number[];
  maxMeasure: number;
};

export function buildPdfPageMeasureIndex(xml: string): PdfPageMeasureIndex {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return { pageStarts: [1], maxMeasure: 1 };
    const part = findXmlParts(doc)[0];
    if (!part) return { pageStarts: [1], maxMeasure: 1 };
    const pageStarts: number[] = [1];
    let maxMeasure = 1;
    for (const measure of [...part.children]) {
      if (xmlLocalName(measure) !== 'measure') continue;
      const mnum = parseMeasureNumber(measure);
      if (mnum == null) continue;
      if (mnum > maxMeasure) maxMeasure = mnum;
      for (const child of [...measure.children]) {
        if (xmlLocalName(child) !== 'print') continue;
        if (child.getAttribute('new-page') !== 'yes') continue;
        // MusicXML: new-page는 보통 새 페이지 첫 마디에 있음 → 그 마디가 페이지 시작
        pageStarts.push(mnum);
      }
    }
    return { pageStarts, maxMeasure: Math.max(1, maxMeasure) };
  } catch {
    return { pageStarts: [1], maxMeasure: 1 };
  }
}

export function measureRangeFromPageIndex(
  index: PdfPageMeasureIndex,
  pdfPage: number,
): { start: number; end: number } {
  const pageN = Math.max(1, Math.floor(pdfPage));
  const starts = index.pageStarts;
  const start = starts[Math.min(pageN, starts.length) - 1] ?? 1;
  const nextStart = starts[pageN] ?? index.maxMeasure + 1;
  return { start, end: Math.max(start, nextStart - 1) };
}

/** MXL 마디 → PDF 페이지 (1-based). 인덱스 없으면 1. */
export function inferPdfPageForMxlMeasure(
  indexOrXml: PdfPageMeasureIndex | string,
  measureMxl: number,
): number {
  const index =
    typeof indexOrXml === 'string' ? buildPdfPageMeasureIndex(indexOrXml) : indexOrXml;
  const m = Math.max(1, Math.floor(measureMxl));
  let page = 1;
  for (let i = 0; i < index.pageStarts.length; i += 1) {
    const start = index.pageStarts[i]!;
    if (start <= m) page = i + 1;
    else break;
  }
  return page;
}

/**
 * PDF 한 페이지의 줄(system)×마디 그리드 — `<print new-system>` 기준.
 * 이미지 위 클릭 오버레이용 (대략 균등 분할; OSMD 좌표 아님).
 */
export function buildPdfPageSystemRows(
  xml: string,
  pdfPage: number,
): number[][] {
  try {
    const range = inferMeasureRangeForPdfPage(xml, pdfPage);
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return [[range.start]];
    const part = findXmlParts(doc)[0];
    if (!part) return [[range.start]];
    const rows: number[][] = [];
    let row: number[] = [];
    for (const measure of [...part.children]) {
      if (xmlLocalName(measure) !== 'measure') continue;
      const mnum = parseMeasureNumber(measure);
      if (mnum == null || mnum < range.start || mnum > range.end) continue;
      let newSystem = false;
      for (const child of [...measure.children]) {
        if (xmlLocalName(child) !== 'print') continue;
        if (child.getAttribute('new-system') === 'yes') newSystem = true;
        if (child.getAttribute('new-page') === 'yes') newSystem = true;
      }
      if (newSystem && row.length) {
        rows.push(row);
        row = [];
      }
      row.push(mnum);
    }
    if (row.length) rows.push(row);
    return rows.length ? rows : [[range.start]];
  } catch {
    return [[1]];
  }
}

/** MusicXML 전체에서 최대 measure@number */
export function maxMxlMeasureNumber(xml: string): number {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return 1;
    let max = 1;
    for (const part of findXmlParts(doc)) {
      for (const child of [...part.children]) {
        if (xmlLocalName(child) !== 'measure') continue;
        const n = parseMeasureNumber(child);
        if (n != null && n > max) max = n;
      }
    }
    return max;
  } catch {
    return 1;
  }
}

/** PDF 페이지 → 해당 페이지에 걸친 MXL 마디 구간 (part 1 `<print new-page>` 기준). */
export function inferMeasureRangeForPdfPage(
  xml: string,
  pdfPage: number,
): { start: number; end: number } {
  // 호환: 호출마다 파싱 — UI는 buildPdfPageMeasureIndex + measureRangeFromPageIndex 권장
  return measureRangeFromPageIndex(buildPdfPageMeasureIndex(xml), pdfPage);
}

/** 마디 머리 attributes에 staff별 clef가 있는지 */
function headAttrsHasClefForStaff(measure: Element, staffN: number): boolean {
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'note' || tag === 'forward' || tag === 'backup') break;
    if (tag !== 'attributes') continue;
    for (const clef of [...child.children].filter((c) => xmlLocalName(c) === 'clef')) {
      const num = clef.getAttribute('number');
      if (num == null || num === '') {
        if (staffN === 1) return true;
        continue;
      }
      if (parseInt(num, 10) === staffN) return true;
    }
  }
  return false;
}

function ensureHeadClef(
  doc: Document,
  measure: Element,
  staffN: number,
  sign: string,
  line: number,
): void {
  if (headAttrsHasClefForStaff(measure, staffN)) return;
  let attrs: Element | null = null;
  let insertBefore: Element | null = null;
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'attributes') {
      attrs = child;
      break;
    }
    if (tag === 'note' || tag === 'forward' || tag === 'backup' || tag === 'direction') {
      insertBefore = child;
      break;
    }
  }
  if (!attrs) {
    attrs = doc.createElementNS(measure.namespaceURI, 'attributes');
    if (insertBefore) measure.insertBefore(attrs, insertBefore);
    else measure.insertBefore(attrs, measure.firstChild);
  }
  const clef = doc.createElementNS(measure.namespaceURI, 'clef');
  if (staffN > 1) clef.setAttribute('number', String(staffN));
  const signEl = doc.createElementNS(measure.namespaceURI, 'sign');
  signEl.textContent = sign;
  const lineEl = doc.createElementNS(measure.namespaceURI, 'line');
  lineEl.textContent = String(line);
  clef.appendChild(signEl);
  clef.appendChild(lineEl);
  attrs.appendChild(clef);
}

/**
 * 구간 필터 전에 — 앞 마디에서 이어진 clef를 구간의 첫 마디 머리에 주입.
 * 마디 단위 OSMD 미리보기에서 setMeasureClef/상속 clef가 안 보이는 문제 방지.
 */
function injectCarriedClefsBeforeFilter(doc: Document, lo: number, hi: number): void {
  for (const part of findXmlParts(doc)) {
    const carried = new Map<number, { sign: string; line: number }>();
    for (const measure of [...part.children]) {
      if (xmlLocalName(measure) !== 'measure') continue;
      const n = parseMeasureNumber(measure);
      if (n == null) continue;
      // 이 마디의 attributes clef로 carried 갱신 (머리+중간)
      for (const child of [...measure.children]) {
        if (xmlLocalName(child) !== 'attributes') continue;
        for (const clef of [...child.children].filter((c) => xmlLocalName(c) === 'clef')) {
          const sign = clef.querySelector('sign, *|sign')?.textContent?.trim().toUpperCase();
          const lineRaw = clef.querySelector('line, *|line')?.textContent?.trim();
          if (!sign) continue;
          const line = lineRaw && /^\d+$/.test(lineRaw) ? parseInt(lineRaw, 10) : sign === 'F' ? 4 : 2;
          const numAttr = clef.getAttribute('number');
          const staffN =
            numAttr && /^\d+$/.test(numAttr) ? parseInt(numAttr, 10) : 1;
          carried.set(staffN, { sign, line });
        }
      }
      if (n >= lo && n <= hi) {
        // 구간 첫 등장 마디(보통 lo)에 아직 머리 clef가 없으면 주입
        for (const [staffN, clef] of carried) {
          ensureHeadClef(doc, measure, staffN, clef.sign, clef.line);
        }
      }
    }
  }
}

/** part·마디 번호는 유지한 채 구간 밖 measure만 제거 (OSMD 마디 클릭 번호 보존). */
export function filterMusicXmlToMeasureRange(xml: string, start: number, end: number): string {
  const lo = Math.max(1, Math.floor(start));
  const hi = Math.max(lo, Math.floor(end));
  const filterDoc = (doc: Document) => {
    injectCarriedClefsBeforeFilter(doc, lo, hi);
    for (const part of findXmlParts(doc)) {
      for (const child of [...part.children]) {
        if (xmlLocalName(child) !== 'measure') continue;
        const n = parseMeasureNumber(child);
        if (n == null || n < lo || n > hi) part.removeChild(child);
      }
    }
    return serializeMusicXmlDocument(doc);
  };
  // 단일 마디·좁은 구간은 max 전수 조사 없이 바로 필터(이미지 PDF 경량 미리보기)
  if (lo === hi || hi - lo < 64) {
    try {
      const doc = parseMusicXmlDocument(xml);
      if (!doc) return xml;
      return filterDoc(doc);
    } catch {
      return xml;
    }
  }
  if (lo <= 1 && hi >= maxMxlMeasureNumber(xml)) return xml;
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    return filterDoc(doc);
  } catch {
    return xml;
  }
}

export function measureRangeOverlaps(
  range: { start: number; end: number },
  measureMxls: Iterable<number>,
): boolean {
  for (const m of measureMxls) {
    if (m >= range.start && m <= range.end) return true;
  }
  return false;
}

export type MxlMeasureRange = { start: number; end: number };

export function pageScopedMeasureSpan(range: MxlMeasureRange): number {
  return Math.max(1, range.end - range.start + 1);
}

/**
 * OSMD가 PDF 페이지 구간만 로드하면 MeasureNumber가 1..k(로컬)로 나올 수 있음.
 * MusicXML measure@number(전곡)로 통일 — HITL·편집 UI와 동일.
 *
 * 단일 마디 미리보기(start===end)에서는 OSMD 로컬/팬텀 번호를 무시하고 항상 그 마디.
 * 구간 밖 값은 페이지 구간으로 클램프(팬텀 마디·잘못된 XML 번호 방지).
 */
export function normalizeToGlobalMeasureMxl(
  osmdOrMxl: number,
  range: MxlMeasureRange | null | undefined,
): number {
  const n = Math.floor(osmdOrMxl);
  if (!Number.isFinite(n)) return n;
  if (!range) return n;
  const { start, end } = range;
  if (!Number.isFinite(start) || start < 1) return n;
  if (end <= start) return start;
  if (n >= start && n <= end) return n;
  const span = pageScopedMeasureSpan(range);
  if (n >= 1 && n <= span) return start + n - 1;
  if (n < 1) return start;
  return Math.min(end, Math.max(start, n));
}

export function measuresMatchInPreview(
  a: number,
  b: number,
  range: MxlMeasureRange | null | undefined,
): boolean {
  return normalizeToGlobalMeasureMxl(a, range) === normalizeToGlobalMeasureMxl(b, range);
}

/** @deprecated 호환용 — inferFirstMxlMeasureForPdfPage 재export */
export { inferFirstMxlMeasureForPdfPage };
