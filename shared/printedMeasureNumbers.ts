/** lyric_manifest / PyMuPDF 검토에서 인쇄 마디 번호 → MXL measure@number 매핑 */

import {
  extractLeadingPrintedMeasureNumberText,
  normalizePrintedMeasureNumberText,
} from './measureNumberText';

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

/** 좌측 줄머리 — 원문자·숫자 마디 번호 위치 */
const SIDEBAR_X_MAX_PT = 130;

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

function itemKey(item: Record<string, unknown>, label: string): string {
  const id = String(item.id ?? item.matchId ?? '');
  if (id) return id;
  const bb = bboxOf(item);
  const pg = itemPage(item);
  if (!bb) return `p${pg}:${label}`;
  return `p${pg}:${label}:${bb.map((v) => Math.round(v)).join(',')}`;
}

function isExcludedManifestItemType(item: Record<string, unknown>): boolean {
  const t = String(item.type ?? '');
  return (
    t === 'page_number' ||
    t === 'title' ||
    t === 'composer' ||
    t === 'copyright' ||
    t === 'tempo'
  );
}

/**
 * PDF 줄머리 `measure_number` 숫자 → MusicXML `measure@number`.
 */
export function printedSidebarNumberToMxlMeasure(
  printedNum: number,
  measureOffsetPrinted: number,
): number {
  const offset = Number.isFinite(measureOffsetPrinted) ? measureOffsetPrinted : 1;
  return printedNum - offset + 1;
}

/** `printedSidebarNumberToMxlMeasure`의 역함수 — HITL UI·마디 편집 표시용. */
export function mxlMeasureToPrintedSidebar(
  mxlMeasure: number,
  measureOffsetPrinted: number,
): number {
  const offset = Number.isFinite(measureOffsetPrinted) ? measureOffsetPrinted : 1;
  return mxlMeasure + offset - 1;
}

/** 우상단 좁은 숫자 = PDF 페이지 인덱스 오인(실제 마디 번호 아님) */
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
  if (x0 < SIDEBAR_X_MAX_PT) {
    return y0 < 200 ? 'sidebar_top' : 'sidebar_bottom';
  }
  return 'other';
}

export function isSidebarMeasureNumberBbox(bbox: number[]): boolean {
  return bbox[0] < SIDEBAR_X_MAX_PT;
}

type ResolvedMeasureNumber = {
  label: string;
  bbox: number[];
  fromSpan: boolean;
};

/** manifest 한 줄에서 인쇄 마디 번호 후보 추출 (없으면 null) */
export function resolveMeasureNumberFromManifestItem(
  item: Record<string, unknown>,
  pageWidthPt = DEFAULT_PAGE_WIDTH_PT,
): ResolvedMeasureNumber | null {
  if (isExcludedManifestItemType(item)) return null;

  const spans = item.spans;
  if (Array.isArray(spans) && spans.length > 0) {
    const first = spans[0];
    if (first && typeof first === 'object') {
      const span = first as Record<string, unknown>;
      const label = extractLeadingPrintedMeasureNumberText(String(span.text ?? ''));
      const spanBbox = span.bbox;
      if (
        label &&
        Array.isArray(spanBbox) &&
        spanBbox.length >= 4 &&
        isSidebarMeasureNumberBbox(spanBbox.map((v) => Number(v)))
      ) {
        const bb = spanBbox.map((v) => Number(v));
        if (classifyMeasureNumberZone(bb, pageWidthPt) !== 'header') {
          return { label, bbox: bb, fromSpan: true };
        }
      }
    }
  }

  const bbox = bboxOf(item);
  if (!bbox) return null;
  const zone = classifyMeasureNumberZone(bbox, pageWidthPt);
  if (zone === 'header') return null;

  const rawText = String(item.text ?? '');
  const leading = extractLeadingPrintedMeasureNumberText(rawText);
  const pure = normalizePrintedMeasureNumberText(rawText);
  const label =
    leading ??
    (pure && pure === stripPua(rawText).trim() ? pure : null);
  if (!label || !MEASURE_NUM_RE.test(label)) return null;

  if (isSidebarMeasureNumberBbox(bbox)) {
    return { label, bbox, fromSpan: false };
  }

  const w = Math.abs(bbox[2] - bbox[0]);
  const t = String(item.type ?? '');
  if (w <= 24 && (t === 'measure_number' || t === '' || t === 'unknown')) {
    return { label, bbox, fromSpan: false };
  }
  return null;
}

export function isMeasureNumberManifestItem(item: Record<string, unknown>): boolean {
  return resolveMeasureNumberFromManifestItem(item) !== null;
}

export function shouldKeepMeasureNumberCandidate(c: ManifestMeasureNumberCandidate): boolean {
  if (c.zone === 'header') return false;
  if (c.zone === 'sidebar_top' || c.zone === 'sidebar_bottom') return c.printed >= 2;
  return c.typed && c.bboxWidth >= 10 && c.printed >= 2;
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
      const resolved = resolveMeasureNumberFromManifestItem(item, pageWidth);
      if (!resolved) continue;

      const key = itemKey(item, resolved.label);
      if (seen.has(key)) continue;
      seen.add(key);

      const printed = parseInt(resolved.label, 10);
      if (!Number.isFinite(printed)) continue;

      const w = Math.abs(resolved.bbox[2] - resolved.bbox[0]);
      const zone = classifyMeasureNumberZone(resolved.bbox, pageWidth);
      const typed = String(item.type ?? '') === 'measure_number';

      out.push({
        page: itemPage(item),
        printed,
        printedLabel: resolved.label,
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
  const kept = candidates.filter(shouldKeepMeasureNumberCandidate);
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
      (x.typed ? 100 : 0) + x.bboxWidth + (x.zone === 'sidebar_bottom' ? 10 : 0);
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

export {
  extractLeadingPrintedMeasureNumberText,
  normalizePrintedMeasureNumberText,
} from './measureNumberText';
