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
  const pageN = Math.max(1, Math.floor(pdfPage));
  const start = inferFirstMxlMeasureForPdfPage(xml, pageN);
  const nextStart = inferFirstMxlMeasureForPdfPage(xml, pageN + 1);
  // 다음 페이지 시작이 보이면 전곡 max 순회 생략
  if (nextStart > start) return { start, end: nextStart - 1 };
  const max = maxMxlMeasureNumber(xml);
  return { start, end: Math.max(start, max) };
}

/** part·마디 번호는 유지한 채 구간 밖 measure만 제거 (OSMD 마디 클릭 번호 보존). */
export function filterMusicXmlToMeasureRange(xml: string, start: number, end: number): string {
  const lo = Math.max(1, Math.floor(start));
  const hi = Math.max(lo, Math.floor(end));
  // 단일 마디·좁은 구간은 max 전수 조사 없이 바로 필터(이미지 PDF 경량 미리보기)
  if (lo === hi || hi - lo < 64) {
    try {
      const doc = parseMusicXmlDocument(xml);
      if (!doc) return xml;
      for (const part of findXmlParts(doc)) {
        for (const child of [...part.children]) {
          if (xmlLocalName(child) !== 'measure') continue;
          const n = parseMeasureNumber(child);
          if (n == null || n < lo || n > hi) part.removeChild(child);
        }
      }
      return serializeMusicXmlDocument(doc);
    } catch {
      return xml;
    }
  }
  if (lo <= 1 && hi >= maxMxlMeasureNumber(xml)) return xml;
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const child of [...part.children]) {
        if (xmlLocalName(child) !== 'measure') continue;
        const n = parseMeasureNumber(child);
        if (n == null || n < lo || n > hi) part.removeChild(child);
      }
    }
    return serializeMusicXmlDocument(doc);
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
 */
export function normalizeToGlobalMeasureMxl(
  osmdOrMxl: number,
  range: MxlMeasureRange | null | undefined,
): number {
  const n = Math.floor(osmdOrMxl);
  if (!Number.isFinite(n) || n < 1) return n;
  if (!range) return n;
  const { start, end } = range;
  if (n >= start && n <= end) return n;
  const span = pageScopedMeasureSpan(range);
  if (n >= 1 && n <= span) return start + n - 1;
  return n;
}

export function measuresMatchInPreview(
  a: number,
  b: number,
  range: MxlMeasureRange | null | undefined,
): boolean {
  return normalizeToGlobalMeasureMxl(a, range) === normalizeToGlobalMeasureMxl(b, range);
}
