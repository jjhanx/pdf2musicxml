/** lyric_manifest / PyMuPDF 검토에서 인쇄 마디 번호 → MXL measure@number 매핑 */

import { normalizePrintedMeasureNumberText } from './measureNumberText';

export type PrintedMeasureMarker = {
  mxlMeasure: number;
  printedLabel: string;
};

export type MeasureNumberZone = 'header' | 'sidebar_top' | 'sidebar_bottom' | 'other';

export type ManifestMeasureNumberCandidate = {
  page: number;
  printed: number;
  printedLabel: string;
  zone: MeasureNumberZone;
  bboxWidth: number;
  typed: boolean;
  itemKey: string;
};

const MEASURE_NUM_RE = /^\d{1,3}$/;

/** A4 기본 폭(pt) — manifest에 pageWidth 없을 때 */
const DEFAULT_PAGE_WIDTH_PT = 595;

function stripPua(text: string): string {
  return text.replace(/[\uE000-\uF8FF]/g, '');
}

function bboxOf(item: Record<string, unknown>): number[] | null {
  const bbox = item.bbox;
  if (!Array.isArray(bbox) || bbox.length < 4) return null;
  return bbox.map((v) => Number(v));
}

function itemPage(item: Record<string, unknown>): number {
  const p = Number(item.page ?? item.pageIndex ?? 0);
  return Number.isFinite(p) ? p : 0;
}

function itemKey(item: Record<string, unknown>): string {
  const id = String(item.id ?? item.matchId ?? '');
  if (id) return id;
  const bb = bboxOf(item);
  const pg = itemPage(item);
  const label =
    normalizePrintedMeasureNumberText(String(item.text ?? '')) ??
    stripPua(String(item.text ?? '')).trim();
  if (!bb) return `p${pg}:${label}`;
  return `p${pg}:${label}:${bb.map((v) => Math.round(v)).join(',')}`;
}

/**
 * PDF 줄머리 `measure_number` 숫자 → MusicXML `measure@number`.
 * HITL 편집(인쇄≈MXL+offset)과 달리, sidebar 숫자 N은 **그 줄의 MXL N**에 붙는 경우가 많아
 * pickup offset만 쓰면 미리보기에서 1마디 앞당겨 보임 → +1 보정.
 */
export function printedSidebarNumberToMxlMeasure(
  printedNum: number,
  measureOffsetPrinted: number,
): number {
  const offset = Number.isFinite(measureOffsetPrinted) ? measureOffsetPrinted : 1;
  return printedNum - offset + 1;
}

/**
 * 악보 인쇄 관례:
 * - 초반(2–11): 페이지 우상단 좁은 숫자(원문자 OCR → 한 자리씩 페이지마다)
 * - 이후: 좌측 줄머리(위·아래 시스템)에 17, 23, 28 …
 */
export function classifyMeasureNumberZone(
  bbox: number[],
  pageWidthPt = DEFAULT_PAGE_WIDTH_PT,
): MeasureNumberZone {
  const x0 = bbox[0];
  const y0 = bbox[1];
  const x1 = bbox[2];
  const w = Math.abs(x1 - x0);
  const rightEdge = pageWidthPt * 0.72;
  if (x0 >= rightEdge && y0 < 110 && w <= 14) return 'header';
  if (x0 < 130) {
    return y0 < 200 ? 'sidebar_top' : 'sidebar_bottom';
  }
  return 'other';
}

export function isMeasureNumberManifestItem(item: Record<string, unknown>): boolean {
  const t = String(item.type ?? '');
  if (t === 'page_number') return false;
  if (t === 'title' || t === 'composer' || t === 'copyright' || t === 'tempo') return false;

  const normalized = normalizePrintedMeasureNumberText(String(item.text ?? ''));
  if (normalized && MEASURE_NUM_RE.test(normalized)) {
    if (t === 'measure_number') return true;
    const bbox = bboxOf(item);
    if (bbox) {
      const w = Math.abs(bbox[2] - bbox[0]);
      if (w > 100) return false;
      if (w <= 24) return true;
    }
    return t === '' || t === 'unknown';
  }

  if (t === 'measure_number') {
    const fallback = stripPua(String(item.text ?? '')).trim();
    return MEASURE_NUM_RE.test(fallback);
  }
  return false;
}

function zonePriority(zone: MeasureNumberZone): number {
  switch (zone) {
    case 'sidebar_bottom':
      return 3;
    case 'sidebar_top':
      return 2;
    case 'header':
      return 1;
    default:
      return 0;
  }
}

/** 영역·숫자 크기 규칙으로 OCR 잡음(사이드바 5·9, 44 등) 제거 */
export function shouldKeepMeasureNumberCandidate(
  c: ManifestMeasureNumberCandidate,
  hasHeaderOpening: boolean,
): boolean {
  const { printed, zone } = c;

  if (!hasHeaderOpening) {
    if (zone === 'sidebar_top' || zone === 'sidebar_bottom') return printed >= 2;
    if (zone === 'header') return printed >= 2 && printed <= 11;
    return c.typed && c.bboxWidth >= 10 && printed >= 2;
  }

  if (zone === 'header') return printed >= 2 && printed <= 11;
  if (zone === 'sidebar_bottom') return printed >= 17;
  if (zone === 'sidebar_top') {
    if (printed <= 11) return false;
    if (printed >= 30) {
      if (printed < 50 && printed % 10 === 4) return false;
      return true;
    }
    return false;
  }
  return c.typed && c.bboxWidth >= 10 && printed >= 2;
}

export function manifestUsesHeaderOpeningMeasureNumbers(
  candidates: ManifestMeasureNumberCandidate[],
): boolean {
  return candidates.some((c) => c.zone === 'header' && c.printed >= 2 && c.printed <= 11);
}

export function collectMeasureNumberCandidatesFromManifest(
  manifest: { items?: unknown[]; pymupdfReviewItems?: unknown[]; pageWidth?: number } | null | undefined,
): ManifestMeasureNumberCandidate[] {
  if (!manifest) return [];
  const pageWidth = Number(manifest.pageWidth) || DEFAULT_PAGE_WIDTH_PT;
  const seen = new Set<string>();
  const out: ManifestMeasureNumberCandidate[] = [];

  const sources: unknown[][] = [];
  if (Array.isArray(manifest.items)) sources.push(manifest.items);
  if (Array.isArray(manifest.pymupdfReviewItems)) sources.push(manifest.pymupdfReviewItems);

  for (const coll of sources) {
    for (const raw of coll) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      if (!isMeasureNumberManifestItem(item)) continue;

      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);

      const label =
        normalizePrintedMeasureNumberText(String(item.text ?? '')) ??
        stripPua(String(item.text ?? '')).trim();
      if (!MEASURE_NUM_RE.test(label)) continue;

      const printed = parseInt(label, 10);
      if (!Number.isFinite(printed)) continue;

      const bbox = bboxOf(item);
      if (!bbox) continue;
      const w = Math.abs(bbox[2] - bbox[0]);
      const zone = classifyMeasureNumberZone(bbox, pageWidth);
      const typed = String(item.type ?? '') === 'measure_number';

      out.push({
        page: itemPage(item),
        printed,
        printedLabel: label,
        zone,
        bboxWidth: w,
        typed,
        itemKey: key,
      });
    }
  }

  return out;
}

export function selectPrintedMeasureMarkersFromCandidates(
  candidates: ManifestMeasureNumberCandidate[],
  measureOffsetPrinted: number,
): PrintedMeasureMarker[] {
  const hasHeaderOpening = manifestUsesHeaderOpeningMeasureNumbers(candidates);
  const minHeaderPage = hasHeaderOpening
    ? Math.min(...candidates.filter((c) => c.zone === 'header').map((c) => c.page))
    : 0;
  const kept = candidates.filter((c) => {
    if (hasHeaderOpening && c.zone !== 'header' && c.page < minHeaderPage) return false;
    return shouldKeepMeasureNumberCandidate(c, hasHeaderOpening);
  });
  const byMxl = new Map<number, ManifestMeasureNumberCandidate>();

  for (const c of kept) {
    const mxl = printedSidebarNumberToMxlMeasure(c.printed, measureOffsetPrinted);
    if (mxl < 1) continue;
    const prev = byMxl.get(mxl);
    if (!prev) {
      byMxl.set(mxl, c);
      continue;
    }
    const score = (x: ManifestMeasureNumberCandidate) =>
      zonePriority(x.zone) * 1000 + x.bboxWidth + (x.typed ? 50 : 0);
    if (score(c) > score(prev)) byMxl.set(mxl, c);
  }

  return [...byMxl.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([mxlMeasure, c]) => ({ mxlMeasure, printedLabel: c.printedLabel }));
}

export function parsePrintedMeasureMarkersFromManifest(
  manifest: { items?: unknown[]; pymupdfReviewItems?: unknown[]; pageWidth?: number } | null | undefined,
  measureOffsetPrinted: number,
): PrintedMeasureMarker[] {
  const candidates = collectMeasureNumberCandidatesFromManifest(manifest);
  return selectPrintedMeasureMarkersFromCandidates(candidates, measureOffsetPrinted);
}

export function printedMeasureMarkerMap(
  markers: PrintedMeasureMarker[],
): ReadonlyMap<number, string> {
  return new Map(markers.map((m) => [m.mxlMeasure, m.printedLabel]));
}

export { normalizePrintedMeasureNumberText } from './measureNumberText';
