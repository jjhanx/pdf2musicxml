import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/** OSMD re-export가 Node/tsx에서 없을 수 있어 로컬 정의(브라우저·Node 공통). */
class PointF2D {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

export type OsmdMeasureClickInfo = {
  measureMxl: number;
  /** OSMD 그래픽 줄(스태프) 인덱스 — 시각적 행. 파트 식별에는 partId를 우선 사용. */
  staffIndex: number;
  /** MusicXML part id (예: "P1"). OSMD Instrument.IdString에서 직접 읽음. */
  partId?: string | null;
  /** 같은 part id가 여러 줄(피아노 PR/PL)일 때 1=윗줄·2=아랫줄 … */
  staffWithinPart?: number | null;
};

type HostBounds = { left: number; top: number; right: number; bottom: number };

type GraphicalMeasureLike = Record<string, unknown>;

type MeasureHitTarget = {
  measureMxl: number;
  staffIndex: number;
  partId: string | null;
  staffWithinPart: number;
  bounds: HostBounds;
  gm: GraphicalMeasureLike;
};

const HIGHLIGHT_LAYER_ATTR = 'data-omr-measure-highlight';
const HOVER_LAYER_ATTR = 'data-omr-measure-hover';
/** 마디 박스 밖이어도 이 거리(px) 안이면 가장 가까운 마디로 스냅 */
const NEAR_HIT_MAX_PX = 40;

const targetCache = new WeakMap<HTMLElement, MeasureHitTarget[]>();
const selectionBoundsCache = new WeakMap<HTMLElement, Map<string, HostBounds>>();

function selectionKey(info: OsmdMeasureClickInfo): string {
  return `${info.staffIndex}|${info.measureMxl}`;
}

function rememberSelectionBounds(host: HTMLElement, info: OsmdMeasureClickInfo, bounds: HostBounds): void {
  if (!isValidHostBounds(bounds)) return;
  let map = selectionBoundsCache.get(host);
  if (!map) {
    map = new Map();
    selectionBoundsCache.set(host, map);
  }
  map.set(selectionKey(info), bounds);
}

function getRememberedSelectionBounds(host: HTMLElement, info: OsmdMeasureClickInfo): HostBounds | null {
  return selectionBoundsCache.get(host)?.get(selectionKey(info)) ?? null;
}

function isValidHostBounds(b: HostBounds): boolean {
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  if (w < 8 || h < 4) return false;
  return true;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function readGraphicSheet(osmd: OpenSheetMusicDisplay): Record<string, unknown> | null {
  const raw = osmd as unknown as Record<string, unknown>;
  return asRecord(raw.graphic ?? raw.GraphicSheet);
}

export function getOsmdUnitInPixels(osmd: OpenSheetMusicDisplay): number {
  const sheet = readGraphicSheet(osmd);
  const rules = asRecord(
    (osmd as unknown as Record<string, unknown>).rules ??
      (osmd as unknown as Record<string, unknown>).EngravingRules ??
      sheet?.rules,
  );
  const uip = rules?.unitInPixels;
  if (typeof uip === 'number' && uip > 0) return uip;
  return 10;
}

function coordNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const r = asRecord(v);
  if (!r) return null;
  if (typeof r.realValue === 'number' && Number.isFinite(r.realValue)) return r.realValue;
  if (typeof r.RealValue === 'number' && Number.isFinite(r.RealValue)) return r.RealValue;
  return null;
}

function readPoint(obj: unknown): { x: number; y: number } | null {
  const rec = asRecord(obj);
  if (!rec) return null;
  const x = coordNum(rec.x ?? rec.X);
  const y = coordNum(rec.y ?? rec.Y);
  if (x == null || y == null) return null;
  return { x, y };
}

function readSourceMeasure(gm: GraphicalMeasureLike): Record<string, unknown> | null {
  return asRecord(gm.parentSourceMeasure ?? gm.ParentSourceMeasure);
}

function readNumberField(obj: Record<string, unknown> | null, keys: string[]): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const n = coordNum(obj[key]);
    if (n != null && Number.isFinite(n)) return Math.floor(n);
  }
  return null;
}

/** MusicXML measure@number. null이면 미확정(0은 pickup 등 유효 번호). */
export function measureMxlFromGraphic(gm: GraphicalMeasureLike): number | null {
  const sm = readSourceMeasure(gm);
  if (sm) {
    for (const keys of [
      ['MeasureNumberXML', 'measureNumberXML'],
      ['MeasureNumber', 'measureNumber'],
    ]) {
      const v = readNumberField(sm, keys);
      if (v != null) return v;
    }
  }
  for (const keys of [
    ['MeasureNumberXML', 'measureNumberXML'],
    ['MeasureNumber', 'measureNumber'],
    ['absoluteMeasureNumber', 'AbsoluteMeasureNumber'],
  ]) {
    const v = readNumberField(gm, keys);
    if (v != null) return v;
  }
  return null;
}

function parentStaffOf(gm: GraphicalMeasureLike): Record<string, unknown> | null {
  return asRecord(gm.ParentStaff ?? gm.parentStaff);
}

/** OSMD Instrument.IdString = MusicXML score-part@id. 줄 인덱스 추측 없이 파트를 확정한다. */
export function partIdFromGraphic(gm: GraphicalMeasureLike): string | null {
  const staff = parentStaffOf(gm);
  const instr = asRecord(staff?.ParentInstrument ?? staff?.parentInstrument);
  const id = instr?.IdString ?? instr?.idString;
  if (typeof id === 'string' && id.trim()) return id.trim();
  return null;
}

function parentStaffLineOf(gm: GraphicalMeasureLike): unknown {
  return gm.ParentStaffLine ?? gm.parentStaffLine ?? null;
}

function resolveMeasureMxlForCell(
  allRows: GraphicalMeasureLike[][],
  mi: number,
  gm: GraphicalMeasureLike,
): number | null {
  const direct = measureMxlFromGraphic(gm);
  if (direct != null) return direct;
  for (const row of allRows) {
    const other = row[mi];
    if (!other) continue;
    const n = measureMxlFromGraphic(other);
    if (n != null) return n;
  }
  return null;
}

function countStaffRows(osmd: OpenSheetMusicDisplay): number {
  let n = 0;
  forEachOsmdSystem(osmd, (_system, rows) => {
    n = Math.max(n, rows.length);
  });
  return n;
}

function normalizeStaffIndex(osmd: OpenSheetMusicDisplay, staffIndex: number): number {
  const rows = countStaffRows(osmd);
  if (rows <= 1) return 0;
  return staffIndex;
}

function isExtraMeasure(gm: GraphicalMeasureLike | null | undefined): boolean {
  if (!gm) return true;
  return Boolean(gm.IsExtraGraphicalMeasure ?? gm.isExtraGraphicalMeasure);
}

function readPositionAndShape(obj: unknown): Record<string, unknown> | null {
  const rec = asRecord(obj);
  if (!rec) return null;
  return asRecord(rec.PositionAndShape ?? rec.positionAndShape);
}

export function getOsmdHostLayout(host: HTMLElement, osmd: OpenSheetMusicDisplay): {
  offsetX: number;
  offsetY: number;
  zoom: number;
  scale: number;
} {
  return getOsmdPageLayout(host, osmd, 0);
}

/** OSMD는 페이지마다 SVG를 따로 만들 수 있으므로 페이지별 오프셋을 계산 */
export function getOsmdPageLayout(host: HTMLElement, osmd: OpenSheetMusicDisplay, pageIndex: number): {
  offsetX: number;
  offsetY: number;
  zoom: number;
  scale: number;
} {
  const zoom = osmd.zoom || 1;
  const scale = getOsmdUnitInPixels(osmd) * zoom;
  const svgs = host.querySelectorAll('svg');
  const hostRect = host.getBoundingClientRect();
  const origin = (svgs[pageIndex] ?? svgs[0])?.getBoundingClientRect() ?? hostRect;
  return {
    offsetX: origin.left - hostRect.left,
    offsetY: origin.top - hostRect.top,
    zoom,
    scale,
  };
}

type HostLayout = ReturnType<typeof getOsmdHostLayout>;

function hostPoint(host: HTMLElement, evt: MouseEvent): { x: number; y: number } {
  const r = host.getBoundingClientRect();
  return { x: evt.clientX - r.left, y: evt.clientY - r.top };
}

export function clientToOsmdPoint(osmd: OpenSheetMusicDisplay, host: HTMLElement, evt: MouseEvent): PointF2D {
  const sheet = readGraphicSheet(osmd);
  const clientPt = new PointF2D(evt.clientX, evt.clientY);
  if (sheet && typeof sheet.domToSvg === 'function') {
    try {
      const svgPt = (sheet.domToSvg as (p: PointF2D) => PointF2D).call(sheet, clientPt);
      if (typeof sheet.svgToOsmd === 'function') {
        return (sheet.svgToOsmd as (p: PointF2D) => PointF2D).call(sheet, svgPt);
      }
      return new PointF2D(svgPt.x / 10, svgPt.y / 10);
    } catch {
      /* fall through */
    }
  }
  const layout = getOsmdHostLayout(host, osmd);
  const hostRect = host.getBoundingClientRect();
  const x = (evt.clientX - hostRect.left - layout.offsetX) / layout.scale;
  const y = (evt.clientY - hostRect.top - layout.offsetY) / layout.scale;
  return new PointF2D(x, y);
}

/**
 * 시스템의 마디를 줄(스태프) 단위 2차원 배열로 만든다 — rows[si] = si번째 줄의 마디들.
 *
 * 주의: OSMD `MusicSystem.GraphicalMeasures`는 [마디][스태프] 순서다(겉이 마디 열).
 * 줄 기준이 필요하므로 각 줄이 자기 마디 목록을 직접 갖는 `StaffLine.Measures`를
 * 일차 소스로 쓰고, 없을 때만 GraphicalMeasures를 전치한다.
 */
function systemRows(system: Record<string, unknown>): GraphicalMeasureLike[][] {
  const staffLines = (system.StaffLines ?? system.staffLines) as unknown[] | undefined;
  const rows: GraphicalMeasureLike[][] = [];
  for (const sl of staffLines ?? []) {
    const slRec = asRecord(sl);
    const measures = (slRec?.Measures ?? slRec?.measures) as GraphicalMeasureLike[] | undefined;
    rows.push((measures ?? []).filter((g) => g && !isExtraMeasure(g)));
  }
  if (rows.some((r) => r.length > 0)) return rows;

  const byMeasure = (system.GraphicalMeasures ?? system.graphicalMeasures) as
    | GraphicalMeasureLike[][]
    | undefined;
  if (!byMeasure?.length) return [];
  const staffCount = Math.max(0, ...byMeasure.map((col) => col?.length ?? 0));
  const transposed: GraphicalMeasureLike[][] = Array.from({ length: staffCount }, () => []);
  for (const col of byMeasure) {
    for (let si = 0; si < (col?.length ?? 0); si += 1) {
      const gm = col?.[si];
      if (gm && !isExtraMeasure(gm)) transposed[si].push(gm);
    }
  }
  return transposed;
}

export function forEachOsmdSystem(
  osmd: OpenSheetMusicDisplay,
  fn: (system: Record<string, unknown>, rows: GraphicalMeasureLike[][], pageIndex: number) => void,
): void {
  const sheet = readGraphicSheet(osmd);
  if (!sheet) return;
  const pages = (sheet.MusicPages ?? sheet.musicPages) as unknown[] | undefined;
  for (let pi = 0; pi < (pages?.length ?? 0); pi += 1) {
    const pageRec = asRecord(pages?.[pi]);
    if (!pageRec) continue;
    for (const system of ((pageRec.MusicSystems ?? pageRec.musicSystems) as unknown[]) ?? []) {
      const sysRec = asRecord(system);
      if (!sysRec) continue;
      const rows = systemRows(sysRec);
      if (!rows.length) continue;
      fn(sysRec, rows, pi);
    }
  }
}

function forEachGraphicalMeasure(
  osmd: OpenSheetMusicDisplay,
  fn: (gm: GraphicalMeasureLike, staffIndex: number, measureIndex: number, row: GraphicalMeasureLike[]) => void,
): void {
  forEachOsmdSystem(osmd, (_system, rows) => {
    for (let si = 0; si < rows.length; si += 1) {
      const row = rows[si] ?? [];
      for (let mi = 0; mi < row.length; mi += 1) {
        const gm = row[mi];
        if (!gm || isExtraMeasure(gm)) continue;
        fn(gm, si, mi, row);
      }
    }
  });
}

function findMeasureGraphic(
  osmd: OpenSheetMusicDisplay,
  measureMxl: number,
  staffIndex: number,
): GraphicalMeasureLike | null {
  let found: GraphicalMeasureLike | null = null;
  forEachGraphicalMeasure(osmd, (gm, si) => {
    if (si !== staffIndex) return;
    if (measureMxlFromGraphic(gm) === measureMxl) found = gm;
  });
  return found;
}

function staffIndexForMeasureGraphic(osmd: OpenSheetMusicDisplay, gm: GraphicalMeasureLike): number {
  let found = 0;
  forEachGraphicalMeasure(osmd, (g, si) => {
    if (g === gm) found = si;
  });
  return found;
}

function measureInfoFromGraphic(
  osmd: OpenSheetMusicDisplay,
  gm: GraphicalMeasureLike,
  staffIndex: number,
): OsmdMeasureClickInfo | null {
  if (isExtraMeasure(gm)) return null;
  const measureMxl = measureMxlFromGraphic(gm);
  if (measureMxl == null) return null;
  return {
    measureMxl,
    staffIndex: normalizeStaffIndex(osmd, staffIndex),
    partId: partIdFromGraphic(gm),
  };
}

function domRectsFromStaffEntry(entry: unknown): DOMRect[] {
  const rects: DOMRect[] = [];
  const e = asRecord(entry);
  if (!e) return rects;
  const gves = (e.graphicalVoiceEntries ?? e.GraphicalVoiceEntries) as unknown[] | undefined;
  for (const gve of gves ?? []) {
    const gr = asRecord(gve);
    const notes = (gr?.notes ?? gr?.Notes ?? gr?.graphicalNotes ?? gr?.GraphicalNotes) as unknown[] | undefined;
    for (const note of notes ?? []) {
      const nr = asRecord(note);
      if (nr && typeof nr.getSVGGElement === 'function') {
        try {
          const el = (nr.getSVGGElement as () => SVGGraphicsElement | null | undefined)();
          if (el?.getBoundingClientRect) {
            const r = el.getBoundingClientRect();
            if (r.width >= 0.5 && r.height >= 0.5) rects.push(r);
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return rects;
}

function domBoundsForMeasure(gm: GraphicalMeasureLike, host: HTMLElement): HostBounds | null {
  const hostRect = host.getBoundingClientRect();
  const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
  if (!Array.isArray(entries) || entries.length === 0) return null;

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const entry of entries) {
    for (const r of domRectsFromStaffEntry(entry)) {
      left = Math.min(left, r.left - hostRect.left);
      top = Math.min(top, r.top - hostRect.top);
      right = Math.max(right, r.right - hostRect.left);
      bottom = Math.max(bottom, r.bottom - hostRect.top);
    }
  }
  if (!Number.isFinite(left)) return null;
  const w = right - left;
  const h = bottom - top;
  if (w < 1 || h < 1) return null;
  const padX = Math.max(4, w * 0.1);
  const padY = Math.max(3, h * 0.15);
  return { left: left - padX, top: top - padY, right: right + padX, bottom: bottom + padY };
}

function graphicHorizontalOsmd(
  gm: GraphicalMeasureLike,
  nextGm: GraphicalMeasureLike | undefined,
  fallbackWidth: number,
): { left: number; right: number } | null {
  const bb = readPositionAndShape(gm);
  const pos = readPoint(bb?.AbsolutePosition ?? bb?.absolutePosition);
  if (!pos) return null;
  const nextBb = nextGm ? readPositionAndShape(nextGm) : null;
  const nextPos = nextBb ? readPoint(nextBb.AbsolutePosition ?? nextBb.absolutePosition) : null;
  if (nextPos && nextPos.x > pos.x + 0.5) {
    return { left: pos.x, right: nextPos.x };
  }
  const sizeRec = asRecord(bb?.Size ?? bb?.size);
  const w = sizeRec ? coordNum(sizeRec.width ?? sizeRec.Width) : null;
  if (nextPos && nextPos.x > pos.x + 0.5) {
    const gap = nextPos.x - pos.x;
    if (gap >= 3) return { left: pos.x, right: nextPos.x };
  }
  const sizeWidthValid = w != null && w > 0.5 && w < 180;
  const width = sizeWidthValid ? w! : fallbackWidth > 0.5 ? fallbackWidth : 28;
  if (width <= 0.5) return null;
  return { left: pos.x, right: pos.x + width };
}

function medianMeasureWidthOsmd(row: GraphicalMeasureLike[]): number {
  const widths: number[] = [];
  for (let i = 0; i < row.length - 1; i += 1) {
    const h = graphicHorizontalOsmd(row[i], row[i + 1], 0);
    if (h) {
      const w = h.right - h.left;
      if (w > 0.5 && w < 180) widths.push(w);
    }
  }
  if (!widths.length) return 28;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)];
}

export function graphicVerticalBoundsOsmd(obj: unknown): { top: number; bottom: number } | null {
  const bb = readPositionAndShape(obj);
  if (!bb) return null;
  const pos = readPoint(bb.AbsolutePosition ?? bb.absolutePosition);
  const sizeRec = asRecord(bb.Size ?? bb.size);
  const h = sizeRec ? coordNum(sizeRec.height ?? sizeRec.Height) : null;
  if (pos && h != null && h > 0.5) {
    return { top: pos.y, bottom: pos.y + h };
  }
  const rect = asRecord(bb.BoundingRectangle ?? bb.boundingRectangle);
  if (rect) {
    const y = coordNum(rect.y ?? rect.Y);
    const rh = coordNum(rect.height ?? rect.Height);
    if (y != null && rh != null && rh > 0.5) {
      return { top: y, bottom: y + rh };
    }
  }
  return null;
}

type Band = { top: number; bottom: number };

function toHostBandFromOsmd(
  v: { top: number; bottom: number },
  layout: HostLayout,
): Band {
  return {
    top: layout.offsetY + v.top * layout.scale,
    bottom: layout.offsetY + v.bottom * layout.scale,
  };
}

/** StaffLine·ParentStaffLine 기준 오선 세로 범위(클릭용 마디 합집합 폴백은 선택). */
function collectStaffLineBandsCore(
  system: Record<string, unknown>,
  rows: GraphicalMeasureLike[][],
  layout: HostLayout,
  opts: { measureFallback: boolean },
): (Band | null)[] {
  const numRows = rows.length;
  const toHostBand = (v: { top: number; bottom: number }) => toHostBandFromOsmd(v, layout);

  const bandByLine = new Map<unknown, Band>();
  const staffLines = (system.StaffLines ?? system.staffLines) as unknown[] | undefined;
  for (const sl of staffLines ?? []) {
    if (!sl) continue;
    const v = graphicVerticalBoundsOsmd(sl);
    if (!v || v.bottom - v.top < 0.3) continue;
    bandByLine.set(sl, toHostBand(v));
  }

  const raw: (Band | null)[] = new Array(numRows).fill(null);
  for (let si = 0; si < numRows; si += 1) {
    const direct = staffLines?.[si] ? bandByLine.get(staffLines[si]) : undefined;
    if (direct) {
      raw[si] = { ...direct };
      continue;
    }
    for (const gm of rows[si] ?? []) {
      if (!gm || isExtraMeasure(gm)) continue;
      const line = parentStaffLineOf(gm);
      const fromLine = line ? bandByLine.get(line) : undefined;
      if (fromLine) {
        raw[si] = { ...fromLine };
        break;
      }
    }
    if (raw[si] || !opts.measureFallback) continue;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const gm of rows[si] ?? []) {
      if (!gm || isExtraMeasure(gm)) continue;
      const v = graphicVerticalBoundsOsmd(gm);
      if (!v) continue;
      top = Math.min(top, v.top);
      bottom = Math.max(bottom, v.bottom);
    }
    if (Number.isFinite(top) && bottom - top > 0.3) {
      raw[si] = toHostBand({ top, bottom });
    }
  }

  const known = raw
    .map((b, i) => (b ? { i, top: b.top, bottom: b.bottom } : null))
    .filter((k): k is { i: number; top: number; bottom: number } => k != null);

  if (!known.length) {
    const sysV = graphicVerticalBoundsOsmd(system);
    if (!sysV) return new Array(numRows).fill(null);
    const b = toHostBand(sysV);
    const h = (b.bottom - b.top) / Math.max(1, numRows);
    return rows.map((_, si) => ({
      top: b.top + si * h,
      bottom: b.top + (si + 1) * h,
    }));
  }

  const avgH = known.reduce((s, k) => s + (k.bottom - k.top), 0) / known.length;
  let pitchSum = 0;
  let pitchN = 0;
  for (let a = 1; a < known.length; a += 1) {
    const d = (known[a].top - known[a - 1].top) / (known[a].i - known[a - 1].i);
    if (d > 1) {
      pitchSum += d;
      pitchN += 1;
    }
  }
  const rowPitch = pitchN > 0 ? pitchSum / pitchN : avgH * 2.2;

  const filled: (Band | null)[] = new Array(numRows).fill(null);
  for (let si = 0; si < numRows; si += 1) {
    const own = raw[si];
    if (own) {
      filled[si] = own;
      continue;
    }
    let below: { i: number; top: number; bottom: number } | null = null;
    let above: { i: number; top: number; bottom: number } | null = null;
    for (const k of known) {
      if (k.i < si) below = k;
      if (k.i > si && !above) above = k;
    }
    if (below && above) {
      const t = (si - below.i) / (above.i - below.i);
      filled[si] = {
        top: below.top + (above.top - below.top) * t,
        bottom: below.bottom + (above.bottom - below.bottom) * t,
      };
    } else if (below) {
      const d = (si - below.i) * rowPitch;
      filled[si] = { top: below.top + d, bottom: below.bottom + d };
    } else if (above) {
      const d = (above.i - si) * rowPitch;
      filled[si] = { top: above.top - d, bottom: above.bottom - d };
    }
  }
  return filled;
}

/** 해당 줄 첫 마디 음표·쉼표 SVG bbox 세로 중앙(host px). */
export function rowNoteAnchorYHost(
  row: GraphicalMeasureLike[],
  host: HTMLElement,
): number | null {
  for (const gm of row) {
    if (!gm || isExtraMeasure(gm)) continue;
    const b = domBoundsForMeasure(gm, host);
    if (b) return (b.top + b.bottom) / 2;
  }
  return null;
}

export function systemHostVerticalRange(
  system: Record<string, unknown>,
  layout: HostLayout,
): { top: number; bottom: number } | null {
  const v = graphicVerticalBoundsOsmd(system);
  if (!v) return null;
  return {
    top: layout.offsetY + v.top * layout.scale,
    bottom: layout.offsetY + v.bottom * layout.scale,
  };
}

/** 성부 라벨용 — 오선(StaffLine) bbox 중앙. 클릭 밴드 확장·마디 합집합 폴백 없음. */
export function buildStaffLineCentersForSystem(
  system: Record<string, unknown>,
  rows: GraphicalMeasureLike[][],
  layout: HostLayout,
): (number | null)[] {
  return collectStaffLineBandsCore(system, rows, layout, { measureFallback: false }).map((b) =>
    b ? (b.top + b.bottom) / 2 : null,
  );
}

/**
 * 시스템 안 각 줄(staff row)의 세로 밴드를 host px로 계산한다.
 *
 * 핵심: 인덱스 보간 추측 대신 OSMD가 알고 있는 정확한 연결
 * (GraphicalMeasure.ParentStaffLine ↔ MusicSystem.StaffLines)을 그대로 사용한다.
 * 이후 인접 줄 사이 빈 공간을 중간선까지 확장해 어느 위치를 클릭해도
 * 시각적으로 가장 가까운 줄로 매핑되게 한다.
 */
export function buildStaffBandsForSystem(
  system: Record<string, unknown>,
  rows: GraphicalMeasureLike[][],
  layout: HostLayout,
): (HostBounds | null)[] {
  const filled = collectStaffLineBandsCore(system, rows, layout, { measureFallback: true });
  const known = filled
    .map((b, i) => (b ? { i, top: b.top, bottom: b.bottom } : null))
    .filter((k): k is { i: number; top: number; bottom: number } => k != null);
  if (!known.length) return filled.map(() => null);

  const avgH = known.reduce((s, k) => s + (k.bottom - k.top), 0) / known.length;
  const margin = Math.max(6, avgH * 0.45);
  const bands: (HostBounds | null)[] = new Array(filled.length).fill(null);
  for (let si = 0; si < filled.length; si += 1) {
    const cur = filled[si];
    if (!cur) continue;
    const prev = si > 0 ? filled[si - 1] : null;
    const next = si < filled.length - 1 ? filled[si + 1] : null;
    const top = prev ? Math.min(cur.top, (prev.bottom + cur.top) / 2) : cur.top - margin;
    const bottom = next ? Math.max(cur.bottom, (cur.bottom + next.top) / 2) : cur.bottom + margin;
    bands[si] = { left: -1e9, right: 1e9, top, bottom };
  }
  return bands;
}

function horizontalBoundsForGraphic(
  gm: GraphicalMeasureLike,
  nextGm: GraphicalMeasureLike | undefined,
  row: GraphicalMeasureLike[],
  layout: HostLayout,
): { left: number; right: number } | null {
  const gH = graphicHorizontalOsmd(gm, nextGm, medianMeasureWidthOsmd(row));
  if (!gH) return null;
  const left = layout.offsetX + gH.left * layout.scale;
  const right = layout.offsetX + gH.right * layout.scale;
  return right - left >= 3 ? { left, right } : null;
}

/** 성부마다 배열 인덱스가 어긋나도 MusicXML 마디 번호로 X 범위를 공유 */
function buildColumnBoundsByMeasureMxl(
  rows: GraphicalMeasureLike[][],
  layout: HostLayout,
): Map<number, { left: number; right: number }> {
  const map = new Map<number, { left: number; right: number }>();
  for (const row of rows) {
    for (let mi = 0; mi < row.length; mi += 1) {
      const gm = row[mi];
      if (!gm || isExtraMeasure(gm)) continue;
      const mxl = resolveMeasureMxlForCell(rows, mi, gm);
      if (mxl == null || map.has(mxl)) continue;
      const h = horizontalBoundsForGraphic(gm, row[mi + 1], row, layout);
      if (h) map.set(mxl, h);
    }
  }
  return map;
}

function interpolateColumnBoundsForMeasure(
  row: GraphicalMeasureLike[],
  mi: number,
  layout: HostLayout,
  colByMxl: Map<number, { left: number; right: number }>,
): { left: number; right: number } | null {
  const gm = row[mi];
  if (!gm || isExtraMeasure(gm)) return null;
  const measureMxl = measureMxlFromGraphic(gm);
  if (measureMxl == null) return null;

  let prev: { mxl: number; col: { left: number; right: number } } | null = null;
  let next: { mxl: number; col: { left: number; right: number } } | null = null;
  for (let j = mi - 1; j >= 0; j -= 1) {
    const other = row[j];
    if (!other || isExtraMeasure(other)) continue;
    const n = measureMxlFromGraphic(other);
    if (n == null) continue;
    const col = colByMxl.get(n);
    if (col && col.right - col.left >= 3) {
      prev = { mxl: n, col };
      break;
    }
  }
  for (let j = mi + 1; j < row.length; j += 1) {
    const other = row[j];
    if (!other || isExtraMeasure(other)) continue;
    const n = measureMxlFromGraphic(other);
    if (n == null) continue;
    const col = colByMxl.get(n);
    if (col && col.right - col.left >= 3) {
      next = { mxl: n, col };
      break;
    }
  }

  const fallbackW = Math.max(24, medianMeasureWidthOsmd(row) * layout.scale);
  if (prev && next && next.mxl > prev.mxl) {
    const t = (measureMxl - prev.mxl) / (next.mxl - prev.mxl);
    const slotLeft = prev.col.right + t * Math.max(8, next.col.left - prev.col.right);
    return { left: slotLeft, right: slotLeft + fallbackW };
  }
  if (prev) return { left: prev.col.right, right: prev.col.right + fallbackW };
  if (next) return { left: next.col.left - fallbackW, right: next.col.left };
  return null;
}

/** graphic 열에 없는 MXL 마디 번호(건너뛴·0폭) — 이웃 마디로 X 슬롯 보간해 HITL 클릭 가능 */
function fillMissingMeasureColumns(
  rows: GraphicalMeasureLike[][],
  layout: HostLayout,
  staffBands: (HostBounds | null)[],
  colByMxl: Map<number, { left: number; right: number }>,
  out: MeasureHitTarget[],
  seen: Set<string>,
): void {
  if (!colByMxl.size) return;
  const sorted = [...colByMxl.keys()].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const fallbackW = Math.max(24, medianMeasureWidthOsmd(rows[0] ?? []) * layout.scale);

  for (let mxl = min; mxl <= max; mxl += 1) {
    if (colByMxl.has(mxl)) continue;
    const prev = [...colByMxl.entries()].filter(([n]) => n < mxl).sort((a, b) => b[0] - a[0])[0];
    const next = [...colByMxl.entries()].filter(([n]) => n > mxl).sort((a, b) => a[0] - b[0])[0];
    let col: { left: number; right: number } | null = null;
    if (prev && next && next[0] > prev[0]) {
      const t = (mxl - prev[0]) / (next[0] - prev[0]);
      const left = prev[1].right + t * Math.max(8, next[1].left - prev[1].right);
      col = { left, right: left + fallbackW };
    } else if (prev) {
      col = { left: prev[1].right, right: prev[1].right + fallbackW };
    } else if (next) {
      col = { left: next[1].left - fallbackW, right: next[1].left };
    }
    if (!col) continue;
    colByMxl.set(mxl, col);

    for (let si = 0; si < rows.length; si += 1) {
      const band = staffBands[si];
      if (!band) continue;
      const bounds: HostBounds = { left: col.left, right: col.right, top: band.top, bottom: band.bottom };
      if (!isValidHostBounds(bounds)) continue;
      const key = `${si}|${mxl}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        measureMxl: mxl,
        staffIndex: si,
        partId: null,
        staffWithinPart: 1,
        bounds,
        gm: {},
      });
    }
  }
}

function collectFromSystem(
  system: Record<string, unknown>,
  rows: GraphicalMeasureLike[][],
  pageIndex: number,
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  out: MeasureHitTarget[],
  seen: Set<string>,
): void {
  const layout = getOsmdPageLayout(host, osmd, pageIndex);
  const staffBands = buildStaffBandsForSystem(system, rows, layout);
  const colByMxl = buildColumnBoundsByMeasureMxl(rows, layout);

  for (let si = 0; si < rows.length; si += 1) {
    const row = rows[si] ?? [];
    const band = staffBands[si];
    for (let mi = 0; mi < row.length; mi += 1) {
      const gm = row[mi];
      if (!gm || isExtraMeasure(gm)) continue;
      const measureMxl = resolveMeasureMxlForCell(rows, mi, gm);
      if (measureMxl == null) continue;
      let col = colByMxl.get(measureMxl) ?? null;
      if (!col) {
        col = horizontalBoundsForGraphic(gm, row[mi + 1], row, layout);
        if (col) colByMxl.set(measureMxl, col);
      }
      if (!col) {
        col = interpolateColumnBoundsForMeasure(row, mi, layout, colByMxl);
        if (col) colByMxl.set(measureMxl, col);
      }
      let bounds: HostBounds | null = null;
      if (col && band) {
        bounds = { left: col.left, right: col.right, top: band.top, bottom: band.bottom };
      } else if (col) {
        const dom = domBoundsForMeasure(gm, host);
        if (dom) bounds = { left: col.left, right: col.right, top: dom.top, bottom: dom.bottom };
      } else {
        bounds = domBoundsForMeasure(gm, host);
      }
      if (!bounds || !isValidHostBounds(bounds)) continue;
      if (measureMxl === 1) {
        const extend = Math.min(120, Math.max(48, (bounds.bottom - bounds.top) * 1.2));
        bounds = { ...bounds, top: bounds.top - extend };
      }
      const key = `${si}|${measureMxl}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        measureMxl,
        staffIndex: si,
        partId: partIdFromGraphic(gm),
        staffWithinPart: 1,
        bounds,
        gm,
      });
    }
  }
  fillMissingMeasureColumns(rows, layout, staffBands, colByMxl, out, seen);
}

export function collectMeasureHitTargets(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
): MeasureHitTarget[] {
  if (!osmd.IsReadyToRender()) return [];

  const out: MeasureHitTarget[] = [];
  const seen = new Set<string>();
  forEachOsmdSystem(osmd, (system, rows, pageIndex) => {
    try {
      collectFromSystem(system, rows, pageIndex, host, osmd, out, seen);
    } catch (e) {
      // 한 시스템의 기하 계산이 실패해도 나머지 시스템 클릭은 살린다
      console.warn('[omr-measure-click] system collect 실패', e);
    }
  });

  if (!out.length) {
    // 마지막 폴백: 마디별 DOM 음표 영역
    try {
      forEachGraphicalMeasure(osmd, (gm, si) => {
        const measureMxl = measureMxlFromGraphic(gm);
        if (measureMxl == null) return;
        const bounds = domBoundsForMeasure(gm, host);
        if (!bounds || !isValidHostBounds(bounds)) return;
        const key = `${si}|${measureMxl}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({
        measureMxl,
        staffIndex: si,
        partId: partIdFromGraphic(gm),
        staffWithinPart: 1,
        bounds,
        gm,
      });
      });
    } catch (e) {
      console.warn('[omr-measure-click] DOM 폴백 collect 실패', e);
    }
  }

  annotateStaffWithinPart(out);
  targetCache.set(host, out);
  return out;
}

/** 피아노 등 한 part id가 여러 줄일 때 윗줄=1, 아랫줄=2 … */
function annotateStaffWithinPart(targets: MeasureHitTarget[]): void {
  const groups = new Map<string, MeasureHitTarget[]>();
  for (const t of targets) {
    if (!t.partId) continue;
    const key = `${t.measureMxl}|${t.partId}`;
    const g = groups.get(key) ?? [];
    g.push(t);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    if (g.length < 2) {
      for (const t of g) t.staffWithinPart = 1;
      continue;
    }
    g.sort((a, b) => a.staffIndex - b.staffIndex);
    g.forEach((t, i) => {
      t.staffWithinPart = i + 1;
    });
  }
}

function pointInBounds(x: number, y: number, b: HostBounds): boolean {
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
}

function distanceToBounds(x: number, y: number, b: HostBounds): number {
  const dx = x < b.left ? b.left - x : x > b.right ? x - b.right : 0;
  const dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
  return Math.hypot(dx, dy);
}

function pickTargetAt(host: HTMLElement, osmd: OpenSheetMusicDisplay, evt: MouseEvent): MeasureHitTarget | null {
  const pt = hostPoint(host, evt);
  let targets = targetCache.get(host);
  if (!targets?.length) targets = collectMeasureHitTargets(osmd, host);

  const hits = targets.filter((t) => pointInBounds(pt.x, pt.y, t.bounds));
  if (hits.length) {
    hits.sort((a, b) => {
      const cyA = (a.bounds.top + a.bounds.bottom) / 2;
      const cyB = (b.bounds.top + b.bounds.bottom) / 2;
      const yDiff = Math.abs(pt.y - cyA) - Math.abs(pt.y - cyB);
      if (Math.abs(yDiff) > 0.5) return yDiff;
      const cxA = (a.bounds.left + a.bounds.right) / 2;
      const cxB = (b.bounds.left + b.bounds.right) / 2;
      return Math.abs(pt.x - cxA) - Math.abs(pt.x - cxB);
    });
    return hits[0] ?? null;
  }

  // 박스 밖이지만 가까운 마디로 스냅 (시스템 사이 여백 등)
  let best: MeasureHitTarget | null = null;
  let bestD = NEAR_HIT_MAX_PX;
  for (const t of targets) {
    const d = distanceToBounds(pt.x, pt.y, t.bounds);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function hitViaNearestStaffEntry(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  evt: MouseEvent,
): OsmdMeasureClickInfo | null {
  const sheet = readGraphicSheet(osmd);
  if (!sheet) return null;
  const pt = clientToOsmdPoint(osmd, host, evt);
  const fn = sheet.GetNearestStaffEntry ?? sheet.getNearestStaffEntry;
  if (typeof fn === 'function') {
    try {
      const entry = (fn as (p: PointF2D) => unknown).call(sheet, pt);
      const e = asRecord(entry);
      const pm = asRecord(e?.parentMeasure ?? e?.ParentMeasure);
      if (pm && !isExtraMeasure(pm)) {
        return measureInfoFromGraphic(osmd, pm, staffIndexForMeasureGraphic(osmd, pm));
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function boundsFromGraphicMeasure(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  info: OsmdMeasureClickInfo,
): HostBounds | null {
  const targets = targetCache.get(host) ?? [];

  // 같은 마디 번호의 다른 줄 셀로 시스템·X 범위를 정하고,
  // 요청한 줄(staffIndex)의 같은 시스템 밴드로 세로를 정한다.
  const colPeers = targets.filter((t) => t.measureMxl === info.measureMxl && isValidHostBounds(t.bounds));
  if (colPeers.length) {
    const left = Math.min(...colPeers.map((t) => t.bounds.left));
    const right = Math.max(...colPeers.map((t) => t.bounds.right));
    const sysTop = Math.min(...colPeers.map((t) => t.bounds.top));
    const sysBottom = Math.max(...colPeers.map((t) => t.bounds.bottom));
    const rowT = targets.find(
      (t) =>
        t.staffIndex === info.staffIndex &&
        t.bounds.top < sysBottom + 1 &&
        t.bounds.bottom > sysTop - 1 &&
        isValidHostBounds(t.bounds),
    );
    if (rowT) {
      const merged = { left, right, top: rowT.bounds.top, bottom: rowT.bounds.bottom };
      if (isValidHostBounds(merged)) return merged;
    }
    // 요청한 줄 셀이 없으면 줄 인덱스가 가장 가까운 같은 마디 셀 사용
    const nearest = [...colPeers].sort(
      (a, b) => Math.abs(a.staffIndex - info.staffIndex) - Math.abs(b.staffIndex - info.staffIndex),
    )[0];
    if (nearest) return nearest.bounds;
  }

  // 그리드가 비어 있으면 해당 줄의 그래픽 마디에서 직접 계산 (다른 줄로 대체하지 않음)
  const gm = findMeasureGraphic(osmd, info.measureMxl, info.staffIndex);
  if (!gm) return null;
  const dom = domBoundsForMeasure(gm, host);
  if (dom && isValidHostBounds(dom)) return dom;
  return null;
}

function boundsForMeasureInfo(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  info: OsmdMeasureClickInfo,
): HostBounds | null {
  // 렌더 직후 다시 수집된 그리드를 우선 사용 (줌·리사이즈 후에도 정확)
  const cached = targetCache.get(host)?.find(
    (t) => t.measureMxl === info.measureMxl && t.staffIndex === info.staffIndex && isValidHostBounds(t.bounds),
  );
  if (cached) return cached.bounds;

  const remembered = getRememberedSelectionBounds(host, info);
  if (remembered) return remembered;

  return boundsFromGraphicMeasure(osmd, host, info);
}

function paintBounds(host: HTMLElement, bounds: HostBounds, layerAttr: string, style: string): void {
  host.querySelectorAll(`[${layerAttr}]`).forEach((el) => el.remove());
  host.style.position = host.style.position || 'relative';
  const layer = document.createElement('div');
  layer.setAttribute(layerAttr, '1');
  layer.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;';
  const box = document.createElement('div');
  box.style.cssText = [
    'position:absolute',
    `left:${bounds.left}px`,
    `top:${bounds.top}px`,
    `width:${Math.max(4, bounds.right - bounds.left)}px`,
    `height:${Math.max(4, bounds.bottom - bounds.top)}px`,
    style,
  ].join(';');
  layer.appendChild(box);
  host.appendChild(layer);
}

export function removeMeasureHover(host: HTMLElement): void {
  host.querySelectorAll(`[${HOVER_LAYER_ATTR}]`).forEach((el) => el.remove());
}

export function removeMeasureClickOverlays(host: HTMLElement): void {
  targetCache.delete(host);
}

export function drawOsmdMeasureHover(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  info: OsmdMeasureClickInfo | null,
  evt?: MouseEvent,
): void {
  removeMeasureHover(host);
  if (!info || !osmd.IsReadyToRender()) return;

  try {
    let bounds: HostBounds | null = null;
    if (evt) {
      const t = pickTargetAt(host, osmd, evt);
      if (
        t &&
        t.measureMxl === info.measureMxl &&
        normalizeStaffIndex(osmd, t.staffIndex) === info.staffIndex &&
        isValidHostBounds(t.bounds)
      ) {
        bounds = t.bounds;
      }
    }
    if (!bounds) bounds = boundsForMeasureInfo(osmd, host, info);
    if (!bounds) return;
    paintBounds(
      host,
      bounds,
      HOVER_LAYER_ATTR,
      'border:2px solid #42a5f5;background:rgba(66,165,245,0.28);border-radius:2px;box-sizing:border-box;',
    );
  } catch (e) {
    console.warn('[omr-measure-click] hover 실패', e);
  }
}

/** OMR 미리보기 스크롤 영역(.omr-mxl-osmd-frame)에서 마디 세로 중앙이 보이도록 스크롤 */
export function scrollOsmdMeasureIntoView(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  info: OsmdMeasureClickInfo,
): void {
  const scrollParent = host.closest('.omr-mxl-osmd-frame') as HTMLElement | null;
  if (!scrollParent) return;

  try {
    const bounds = boundsForMeasureInfo(osmd, host, info);
    if (!bounds || !isValidHostBounds(bounds)) return;

    const measureMidYInHost = bounds.top + (bounds.bottom - bounds.top) / 2;
    const hostRect = host.getBoundingClientRect();
    const measureScreenY = hostRect.top + measureMidYInHost;
    const frameRect = scrollParent.getBoundingClientRect();
    const measureInContent = measureScreenY - frameRect.top + scrollParent.scrollTop;
    const targetScroll = measureInContent - scrollParent.clientHeight / 2;

    scrollParent.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: 'smooth',
    });
  } catch (e) {
    console.warn('[omr-measure-click] scroll 실패', e);
  }
}

export function drawOsmdMeasureHighlight(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  measureMxl: number | null | undefined,
  staffIndex?: number | null,
): void {
  host.querySelectorAll(`[${HIGHLIGHT_LAYER_ATTR}]`).forEach((el) => el.remove());
  if (measureMxl == null || measureMxl < 0 || !osmd.IsReadyToRender()) return;
  try {
    const bounds = boundsForMeasureInfo(osmd, host, {
      measureMxl,
      staffIndex: staffIndex ?? 0,
    });
    if (!bounds) return;
    paintBounds(
      host,
      bounds,
      HIGHLIGHT_LAYER_ATTR,
      'border:2px solid #1565c0;background:rgba(21,101,192,0.2);border-radius:2px;box-sizing:border-box;',
    );
  } catch (e) {
    console.warn('[omr-measure-click] highlight 실패', e);
  }
}

export function installMeasureClickOverlays(host: HTMLElement, osmd: OpenSheetMusicDisplay): number {
  return collectMeasureHitTargets(osmd, host).length;
}

export function hitTestOsmdMeasure(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  evt: MouseEvent,
): OsmdMeasureClickInfo | null {
  if (!osmd.IsReadyToRender()) return null;
  try {
    const t = pickTargetAt(host, osmd, evt);
    if (t) {
      const info: OsmdMeasureClickInfo = {
        measureMxl: t.measureMxl,
        staffIndex: normalizeStaffIndex(osmd, t.staffIndex),
        partId: t.partId,
        staffWithinPart: t.staffWithinPart,
      };
      rememberSelectionBounds(host, info, t.bounds);
      return info;
    }
    const near = hitViaNearestStaffEntry(osmd, host, evt);
    if (!near) return null;
    const targets = targetCache.get(host);
    const peer = targets?.find(
      (t) => t.measureMxl === near.measureMxl && t.staffIndex === near.staffIndex,
    );
    const info: OsmdMeasureClickInfo = {
      ...near,
      staffIndex: normalizeStaffIndex(osmd, near.staffIndex),
      staffWithinPart: peer?.staffWithinPart ?? near.staffWithinPart,
    };
    const domBounds = boundsFromGraphicMeasure(osmd, host, info);
    if (domBounds) rememberSelectionBounds(host, info, domBounds);
    return info;
  } catch (e) {
    console.warn('[omr-measure-click] hit test 실패', e);
    return null;
  }
}

export function invalidateMeasureTargetCache(host: HTMLElement): void {
  targetCache.delete(host);
}

export function clearMeasureSelectionBounds(host: HTMLElement): void {
  selectionBoundsCache.delete(host);
}
