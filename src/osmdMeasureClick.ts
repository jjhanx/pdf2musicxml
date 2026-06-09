import { PointF2D, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type OsmdMeasureClickInfo = {
  /** MusicXML measure@number (API·편집용) */
  measureMxl: number;
  /** OSMD 악보 줄 인덱스 (graphicalMeasures 행, 0=S 등) */
  staffIndex: number;
};

type HostBounds = { left: number; top: number; right: number; bottom: number };

type GraphicalMeasureLike = Record<string, unknown>;

type MeasureHitTarget = {
  measureMxl: number;
  staffIndex: number;
  bounds: HostBounds;
  gm: GraphicalMeasureLike;
};

const HIGHLIGHT_LAYER_ATTR = 'data-omr-measure-highlight';
const HOVER_LAYER_ATTR = 'data-omr-measure-hover';

const targetCache = new WeakMap<HTMLElement, MeasureHitTarget[]>();

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
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  }
  return null;
}

export function measureMxlFromGraphic(gm: GraphicalMeasureLike): number {
  const sm = readSourceMeasure(gm);
  const xml = readNumberField(sm, ['MeasureNumberXML', 'measureNumberXML']);
  if (xml != null) return xml;
  return readNumberField(gm, ['MeasureNumberXML', 'measureNumberXML', 'MeasureNumber', 'measureNumber']) ?? 0;
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
  const zoom = osmd.zoom || 1;
  const scale = getOsmdUnitInPixels(osmd) * zoom;
  const svg = host.querySelector('svg');
  const hostRect = host.getBoundingClientRect();
  const origin = svg?.getBoundingClientRect() ?? hostRect;
  return {
    offsetX: origin.left - hostRect.left,
    offsetY: origin.top - hostRect.top,
    zoom,
    scale,
  };
}

function hostPoint(host: HTMLElement, evt: MouseEvent): { x: number; y: number } {
  const r = host.getBoundingClientRect();
  return { x: evt.clientX - r.left, y: evt.clientY - r.top };
}

function osmdXToHost(x: number, layout: ReturnType<typeof getOsmdHostLayout>): number {
  return layout.offsetX + x * layout.scale;
}

function graphicVerticalBoundsOsmd(obj: unknown): HostBounds | null {
  const bb = readPositionAndShape(obj);
  if (!bb) return null;
  const pos = readPoint(bb.AbsolutePosition ?? bb.absolutePosition);
  const sizeRec = asRecord(bb.Size ?? bb.size);
  const h = sizeRec ? coordNum(sizeRec.height ?? sizeRec.Height) : null;
  if (pos && h != null && h > 0.5) {
    return { left: pos.x, top: pos.y, right: pos.x + 1, bottom: pos.y + h };
  }
  const rect = asRecord(bb.BoundingRectangle ?? bb.boundingRectangle);
  if (rect) {
    const y = coordNum(rect.y ?? rect.Y);
    const rh = coordNum(rect.height ?? rect.Height);
    const x = coordNum(rect.x ?? rect.X);
    if (y != null && rh != null && rh > 0.5) {
      return { left: x ?? 0, top: y, right: (x ?? 0) + 1, bottom: y + rh };
    }
  }
  return null;
}

function staffRowBoundsInHost(
  system: Record<string, unknown>,
  staffIndex: number,
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): HostBounds | null {
  const layout = getOsmdHostLayout(host, osmd);
  const staffLines = (system.StaffLines ?? system.staffLines) as unknown[] | undefined;
  const sl = staffLines?.[staffIndex];
  if (sl) {
    const v = graphicVerticalBoundsOsmd(sl);
    if (v) {
      return {
        left: 0,
        top: layout.offsetY + v.top * layout.scale,
        right: host.clientWidth,
        bottom: layout.offsetY + v.bottom * layout.scale,
      };
    }
  }
  return null;
}

function domRectsFromStaffEntry(entry: unknown): DOMRect[] {
  const rects: DOMRect[] = [];
  const e = asRecord(entry);
  if (!e) return rects;
  const gves = (e.graphicalVoiceEntries ?? e.GraphicalVoiceEntries) as unknown[] | undefined;
  for (const gve of gves ?? []) {
    const gr = asRecord(gve);
    const notes = (gr?.notes ?? gr?.Notes) as unknown[] | undefined;
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

function domHorizontalForMeasure(gm: GraphicalMeasureLike, host: HTMLElement): { left: number; right: number } | null {
  const hostRect = host.getBoundingClientRect();
  const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
  if (!Array.isArray(entries)) return null;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    for (const r of domRectsFromStaffEntry(entry)) {
      left = Math.min(left, r.left - hostRect.left);
      right = Math.max(right, r.right - hostRect.left);
    }
  }
  if (!Number.isFinite(left)) return null;
  const pad = Math.max(6, (right - left) * 0.15);
  return { left: left - pad, right: right + pad };
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
  const width = w != null && w > 0.5 && w < 180 ? w : fallbackWidth;
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

function measureCellBoundsInHost(
  gm: GraphicalMeasureLike,
  nextGm: GraphicalMeasureLike | undefined,
  system: Record<string, unknown> | null,
  staffIndex: number,
  row: GraphicalMeasureLike[],
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): HostBounds | null {
  const layout = getOsmdHostLayout(host, osmd);
  const fallbackW = medianMeasureWidthOsmd(row);

  let top: number;
  let bottom: number;
  const staffBand = system ? staffRowBoundsInHost(system, staffIndex, host, osmd) : null;
  if (staffBand) {
    top = staffBand.top;
    bottom = staffBand.bottom;
  } else {
    const hostRect = host.getBoundingClientRect();
    const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
    let t = Number.POSITIVE_INFINITY;
    let b = Number.NEGATIVE_INFINITY;
    for (const entry of entries ?? []) {
      for (const r of domRectsFromStaffEntry(entry)) {
        t = Math.min(t, r.top - hostRect.top);
        b = Math.max(b, r.bottom - hostRect.top);
      }
    }
    if (!Number.isFinite(t)) return null;
    const padY = Math.max(4, (b - t) * 0.2);
    top = t - padY;
    bottom = b + padY;
  }

  const domH = domHorizontalForMeasure(gm, host);
  if (domH) {
    return { left: domH.left, top, right: domH.right, bottom };
  }

  const gH = graphicHorizontalOsmd(gm, nextGm, fallbackW);
  if (!gH) return null;
  return {
    left: osmdXToHost(gH.left, layout),
    top,
    right: osmdXToHost(gH.right, layout),
    bottom,
  };
}

function forEachMeasureCell(
  osmd: OpenSheetMusicDisplay,
  fn: (
    gm: GraphicalMeasureLike,
    staffIndex: number,
    measureIndex: number,
    row: GraphicalMeasureLike[],
    system: Record<string, unknown> | null,
  ) => void,
): void {
  const sheet = readGraphicSheet(osmd);
  if (!sheet) return;

  let fromPages = 0;
  for (const page of (sheet.MusicPages ?? sheet.musicPages) as unknown[]) {
    const pageRec = asRecord(page);
    if (!pageRec) continue;
    for (const system of (pageRec.MusicSystems ?? pageRec.musicSystems) as unknown[]) {
      const sysRec = asRecord(system);
      if (!sysRec) continue;
      const rows = (sysRec.GraphicalMeasures ?? sysRec.graphicalMeasures) as GraphicalMeasureLike[][] | undefined;
      for (let si = 0; si < (rows?.length ?? 0); si += 1) {
        const row = rows?.[si] ?? [];
        for (let mi = 0; mi < row.length; mi += 1) {
          const gm = row[mi];
          if (!gm || isExtraMeasure(gm)) continue;
          fn(gm, si, mi, row, sysRec);
          fromPages += 1;
        }
      }
    }
  }
  if (fromPages > 0) return;

  const list = (sheet.MeasureList ?? sheet.measureList) as GraphicalMeasureLike[][] | undefined;
  if (!list?.length) return;
  const dim0 = list.length;
  const dim1 = list[0]?.length ?? 0;
  const numStaves = (sheet.NumberOfStaves ?? sheet.numberOfStaves) as number | undefined;
  const measureMajor =
    (numStaves ?? 0) > 0
      ? dim1 === numStaves || (dim1 <= (numStaves ?? 0) + 1 && dim0 > dim1)
      : dim0 >= dim1;

  if (measureMajor) {
    for (let si = 0; si < dim1; si += 1) {
      const row = Array.from({ length: dim0 }, (_, i) => list[i]?.[si]).filter(
        (g): g is GraphicalMeasureLike => Boolean(g) && !isExtraMeasure(g),
      );
      for (let mi = 0; mi < dim0; mi += 1) {
        const gm = list[mi]?.[si];
        if (!gm || isExtraMeasure(gm)) continue;
        fn(gm, si, mi, row, null);
      }
    }
  } else {
    for (let si = 0; si < dim0; si += 1) {
      const row = list[si] ?? [];
      for (let mi = 0; mi < dim1; mi += 1) {
        const gm = list[si]?.[mi];
        if (!gm || isExtraMeasure(gm)) continue;
        fn(gm, si, mi, row, null);
      }
    }
  }
}

export function collectMeasureHitTargets(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
): MeasureHitTarget[] {
  if (!osmd.IsReadyToRender()) return [];

  const out: MeasureHitTarget[] = [];
  const seen = new Set<string>();

  forEachMeasureCell(osmd, (gm, staffIndex, measureIndex, row, system) => {
    const measureMxl = measureMxlFromGraphic(gm);
    if (!measureMxl) return;
    const nextGm = row[measureIndex + 1];
    const bounds = measureCellBoundsInHost(gm, nextGm, system, staffIndex, row, host, osmd);
    if (!bounds) return;
    const w = bounds.right - bounds.left;
    const h = bounds.bottom - bounds.top;
    if (w < 4 || h < 4) return;
    const key = `${staffIndex}|${measureMxl}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ measureMxl, staffIndex, bounds, gm });
  });

  targetCache.set(host, out);
  return out;
}

function pointInBounds(x: number, y: number, b: HostBounds): boolean {
  return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
}

function boundsArea(b: HostBounds): number {
  return (b.right - b.left) * (b.bottom - b.top);
}

function pickTargetAt(host: HTMLElement, osmd: OpenSheetMusicDisplay, evt: MouseEvent): MeasureHitTarget | null {
  const pt = hostPoint(host, evt);
  let targets = targetCache.get(host);
  if (!targets?.length) targets = collectMeasureHitTargets(osmd, host);
  if (!targets.length) return null;

  const hits = targets.filter((t) => pointInBounds(pt.x, pt.y, t.bounds));
  if (!hits.length) return null;

  hits.sort((a, b) => {
    const cyA = (a.bounds.top + a.bounds.bottom) / 2;
    const cyB = (b.bounds.top + b.bounds.bottom) / 2;
    const yDiff = Math.abs(pt.y - cyA) - Math.abs(pt.y - cyB);
    if (yDiff !== 0) return yDiff;
    const cxA = (a.bounds.left + a.bounds.right) / 2;
    const cxB = (b.bounds.left + b.bounds.right) / 2;
    const xDiff = Math.abs(pt.x - cxA) - Math.abs(pt.x - cxB);
    if (xDiff !== 0) return xDiff;
    return boundsArea(a.bounds) - boundsArea(b.bounds);
  });
  return hits[0] ?? null;
}

function targetToInfo(t: MeasureHitTarget): OsmdMeasureClickInfo {
  return { measureMxl: t.measureMxl, staffIndex: t.staffIndex };
}

function findTarget(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  measureMxl: number,
  staffIndex: number,
): MeasureHitTarget | null {
  let targets = targetCache.get(host);
  if (!targets?.length) targets = collectMeasureHitTargets(osmd, host);
  return targets.find((t) => t.measureMxl === measureMxl && t.staffIndex === staffIndex) ?? null;
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
    `width:${bounds.right - bounds.left}px`,
    `height:${bounds.bottom - bounds.top}px`,
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
): void {
  removeMeasureHover(host);
  if (!info || !osmd.IsReadyToRender()) return;
  const t = findTarget(osmd, host, info.measureMxl, info.staffIndex);
  if (!t) return;
  paintBounds(
    host,
    t.bounds,
    HOVER_LAYER_ATTR,
    'border:2px solid #42a5f5;background:rgba(66,165,245,0.2);border-radius:2px;box-sizing:border-box;',
  );
}

export function drawOsmdMeasureHighlight(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  measureMxl: number | null | undefined,
  staffIndex?: number | null,
): void {
  host.querySelectorAll(`[${HIGHLIGHT_LAYER_ATTR}]`).forEach((el) => el.remove());
  if (!measureMxl || measureMxl < 1 || !osmd.IsReadyToRender()) return;
  const si = staffIndex ?? 0;
  const t = findTarget(osmd, host, measureMxl, si);
  if (!t) return;
  paintBounds(
    host,
    t.bounds,
    HIGHLIGHT_LAYER_ATTR,
    'border:2px solid #1565c0;background:rgba(21,101,192,0.14);border-radius:2px;box-sizing:border-box;',
  );
}

export function installMeasureClickOverlays(host: HTMLElement, osmd: OpenSheetMusicDisplay): number {
  return collectMeasureHitTargets(osmd, host).length;
}

/** 클릭 좌표가 들어가는 마디 셀 (성부 줄 + 마디 열) */
export function hitTestOsmdMeasure(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  evt: MouseEvent,
): OsmdMeasureClickInfo | null {
  if (!osmd.IsReadyToRender()) return null;
  const t = pickTargetAt(host, osmd, evt);
  return t ? targetToInfo(t) : null;
}

export function invalidateMeasureTargetCache(host: HTMLElement): void {
  targetCache.delete(host);
}
