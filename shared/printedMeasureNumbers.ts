/** lyric_manifest / PyMuPDF 검토에서 인쇄 마디 번호 → MXL measure@number 매핑 */

export type PrintedMeasureMarker = {
  mxlMeasure: number;
  printedLabel: string;
};

const MEASURE_NUM_RE = /^\d{1,3}$/;

function stripPua(text: string): string {
  return text.replace(/[\uE000-\uF8FF]/g, '');
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

export function isMeasureNumberManifestItem(item: Record<string, unknown>): boolean {
  const t = String(item.type ?? '');
  if (t === 'page_number') return false;
  if (t === 'measure_number') return true;
  if (t === 'title' || t === 'composer' || t === 'copyright' || t === 'tempo') return false;
  const text = stripPua(String(item.text ?? '')).trim();
  if (!MEASURE_NUM_RE.test(text)) return false;
  const bbox = item.bbox;
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const w = Math.abs(Number(bbox[2]) - Number(bbox[0]));
    if (w > 100) return false;
    if (w <= 24) return true;
  }
  return t === '' || t === 'unknown';
}

export function parsePrintedMeasureMarkersFromManifest(
  manifest: { items?: unknown[]; pymupdfReviewItems?: unknown[] } | null | undefined,
  measureOffsetPrinted: number,
): PrintedMeasureMarker[] {
  if (!manifest) return [];
  const offset = Number.isFinite(measureOffsetPrinted) ? measureOffsetPrinted : 1;
  const byMxl = new Map<number, string>();
  const sources: unknown[][] = [];
  if (Array.isArray(manifest.items)) sources.push(manifest.items);
  if (Array.isArray(manifest.pymupdfReviewItems)) sources.push(manifest.pymupdfReviewItems);
  for (const coll of sources) {
    for (const raw of coll) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      if (!isMeasureNumberManifestItem(item)) continue;
      const printed = stripPua(String(item.text ?? '')).trim();
      const printedNum = parseInt(printed, 10);
      if (!Number.isFinite(printedNum)) continue;
      const mxlMeasure = printedSidebarNumberToMxlMeasure(printedNum, offset);
      if (mxlMeasure < 1) continue;
      if (!byMxl.has(mxlMeasure)) byMxl.set(mxlMeasure, printed);
    }
  }
  return [...byMxl.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([mxlMeasure, printedLabel]) => ({ mxlMeasure, printedLabel }));
}

export function printedMeasureMarkerMap(
  markers: PrintedMeasureMarker[],
): ReadonlyMap<number, string> {
  return new Map(markers.map((m) => [m.mxlMeasure, m.printedLabel]));
}
