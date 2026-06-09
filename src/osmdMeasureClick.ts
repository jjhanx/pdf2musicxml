import { PointF2D, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type OsmdMeasureClickInfo = {
  measureMxl: number;
  staffIndex: number;
  measurePrinted?: number;
};

type HostBounds = { left: number; top: number; right: number; bottom: number };

type GraphicalMeasureLike = Record<string, unknown>;

const CLICK_LAYER_ATTR = 'data-omr-measure-click-layer';
const HIGHLIGHT_LAYER_ATTR = 'data-omr-measure-highlight';
const HOVER_LAYER_ATTR = 'data-omr-measure-hover';

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
  const onGm = readNumberField(gm, ['MeasureNumberXML', 'measureNumberXML', 'MeasureNumber', 'measureNumber']);
  return onGm ?? 0;
}

export function measurePrintedFromGraphic(gm: GraphicalMeasureLike): number {
  const sm = readSourceMeasure(gm);
  const display = readNumberField(sm, ['MeasureNumber', 'measureNumber']);
  if (display != null && display > 0) return display;
  const onGm = readNumberField(gm, ['MeasureNumber', 'measureNumber']);
  if (onGm != null && onGm > 0) return onGm;
  const mxl = measureMxlFromGraphic(gm);
  return mxl > 0 ? mxl : 0;
}

function isExtraMeasure(gm: GraphicalMeasureLike | null | undefined): boolean {
  if (!gm) return true;
  return Boolean(gm.IsExtraGraphicalMeasure ?? gm.isExtraGraphicalMeasure);
}

/** OSMD 악보 좌표(클릭·GetNearestStaffEntry용) */
export function clientToOsmdPoint(osmd: OpenSheetMusicDisplay, evt: MouseEvent): PointF2D {
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
  const host = (evt.currentTarget as HTMLElement | null) ?? document.elementFromPoint(evt.clientX, evt.clientY);
  if (host) {
    const rect = host.getBoundingClientRect();
    const unit = getOsmdUnitInPixels(osmd);
    const zoom = osmd.zoom || 1;
    const svg = host.querySelector('svg');
    const origin = svg?.getBoundingClientRect() ?? rect;
    const x = (evt.clientX - origin.left) / (unit * zoom);
    const y = (evt.clientY - origin.top) / (unit * zoom);
    return new PointF2D(x, y);
  }
  return new PointF2D(0, 0);
}

function staffIndexForMeasureGraphic(osmd: OpenSheetMusicDisplay, gm: GraphicalMeasureLike): number {
  let found = 0;
  forEachGraphicalMeasure(osmd, (g, si) => {
    if (g === gm) found = si;
  });
  return found;
}

function measureInfoFromGraphicMeasure(
  gm: GraphicalMeasureLike,
  staffIndex: number,
): OsmdMeasureClickInfo | null {
  if (isExtraMeasure(gm)) return null;
  const measureMxl = measureMxlFromGraphic(gm);
  if (!measureMxl) return null;
  return {
    measureMxl,
    staffIndex,
    measurePrinted: measurePrintedFromGraphic(gm) || undefined,
  };
}

function measureInfoFromStaffEntry(osmd: OpenSheetMusicDisplay, entry: unknown): OsmdMeasureClickInfo | null {
  const e = asRecord(entry);
  if (!e) return null;
  const pm = asRecord(e.parentMeasure ?? e.ParentMeasure);
  if (!pm) return null;
  const staffIndex = staffIndexForMeasureGraphic(osmd, pm);
  return measureInfoFromGraphicMeasure(pm, staffIndex);
}

function hitViaNearestStaffEntry(osmd: OpenSheetMusicDisplay, evt: MouseEvent): OsmdMeasureClickInfo | null {
  const sheet = readGraphicSheet(osmd);
  if (!sheet) return null;
  const pt = clientToOsmdPoint(osmd, evt);
  const fn = sheet.GetNearestStaffEntry ?? sheet.getNearestStaffEntry;
  if (typeof fn === 'function') {
    try {
      const entry = (fn as (p: PointF2D) => unknown).call(sheet, pt);
      const info = measureInfoFromStaffEntry(osmd, entry);
      if (info) return info;
    } catch {
      /* fall through */
    }
  }
  const getClicked = sheet.getClickedObject ?? sheet.GetClickedObject;
  if (typeof getClicked === 'function') {
    try {
      const clicked = (getClicked as (p: PointF2D) => unknown).call(sheet, pt);
      let cur: unknown = clicked;
      for (let d = 0; d < 20 && cur; d += 1) {
        const r = asRecord(cur);
        if (!r) break;
        const pm = asRecord(r.parentMeasure ?? r.ParentMeasure);
        if (pm && !isExtraMeasure(pm)) {
          const info = measureInfoFromGraphicMeasure(pm, staffIndexForMeasureGraphic(osmd, pm));
          if (info) return info;
        }
        cur = r.parentMeasure ?? r.ParentMeasure ?? r.parentStaffEntry ?? r.ParentStaffEntry;
      }
    } catch {
      /* ignore */
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
  if (w < 2 || h < 2) return null;

  const padX = Math.max(4, w * 0.08);
  const padY = Math.max(3, h * 0.12);
  return {
    left: left - padX,
    top: top - padY,
    right: right + padX,
    bottom: bottom + padY,
  };
}

function readPositionAndShape(obj: unknown): Record<string, unknown> | null {
  const rec = asRecord(obj);
  if (!rec) return null;
  return asRecord(rec.PositionAndShape ?? rec.positionAndShape);
}

function graphicOsmdBounds(gm: GraphicalMeasureLike): HostBounds | null {
  const bb = readPositionAndShape(gm);
  if (!bb) return null;
  const pos = readPoint(bb.AbsolutePosition ?? bb.absolutePosition);
  const sizeRec = asRecord(bb.Size ?? bb.size);
  const w = sizeRec ? coordNum(sizeRec.width ?? sizeRec.Width) : null;
  const h = sizeRec ? coordNum(sizeRec.height ?? sizeRec.Height) : null;
  if (pos && w != null && h != null && w > 0.5 && h > 0.5 && w < 200) {
    return { left: pos.x, top: pos.y, right: pos.x + w, bottom: pos.y + h };
  }
  const rect = asRecord(bb.BoundingRectangle ?? bb.boundingRectangle);
  if (rect) {
    const x = coordNum(rect.x ?? rect.X);
    const y = coordNum(rect.y ?? rect.Y);
    const rw = coordNum(rect.width ?? rect.Width);
    const rh = coordNum(rect.height ?? rect.Height);
    if (x != null && y != null && rw != null && rh != null && rw < 200) {
      return { left: x, top: y, right: x + rw, bottom: y + rh };
    }
  }
  return null;
}

function osmdBoundsToHost(bounds: HostBounds, host: HTMLElement, osmd: OpenSheetMusicDisplay): HostBounds {
  const unit = getOsmdUnitInPixels(osmd);
  const zoom = osmd.zoom || 1;
  const scale = unit * zoom;
  const svg = host.querySelector('svg');
  const hostRect = host.getBoundingClientRect();
  const origin = svg?.getBoundingClientRect() ?? hostRect;
  const offsetX = origin.left - hostRect.left;
  const offsetY = origin.top - hostRect.top;
  return {
    left: offsetX + bounds.left * scale,
    top: offsetY + bounds.top * scale,
    right: offsetX + bounds.right * scale,
    bottom: offsetY + bounds.bottom * scale,
  };
}

function boundsForMeasure(
  gm: GraphicalMeasureLike,
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): HostBounds | null {
  const dom = domBoundsForMeasure(gm, host);
  if (dom) return dom;
  const g = graphicOsmdBounds(gm);
  if (g) return osmdBoundsToHost(g, host, osmd);
  return null;
}

function forEachGraphicalMeasure(
  osmd: OpenSheetMusicDisplay,
  fn: (gm: GraphicalMeasureLike, staffIndex: number) => void,
): void {
  const sheet = readGraphicSheet(osmd);
  if (!sheet) return;

  const pages = (sheet.MusicPages ?? sheet.musicPages) as unknown[] | undefined;
  let count = 0;
  for (const page of pages ?? []) {
    const pageRec = asRecord(page);
    if (!pageRec) continue;
    const systems = (pageRec.MusicSystems ?? pageRec.musicSystems) as unknown[] | undefined;
    for (const system of systems ?? []) {
      const sysRec = asRecord(system);
      if (!sysRec) continue;
      const rows = (sysRec.GraphicalMeasures ?? sysRec.graphicalMeasures) as GraphicalMeasureLike[][] | undefined;
      for (let si = 0; si < (rows?.length ?? 0); si += 1) {
        for (const gm of rows?.[si] ?? []) {
          if (!gm || isExtraMeasure(gm)) continue;
          fn(gm, si);
          count += 1;
        }
      }
    }
  }
  if (count > 0) return;

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
    for (let mi = 0; mi < dim0; mi += 1) {
      for (let si = 0; si < dim1; si += 1) {
        const gm = list[mi]?.[si];
        if (!gm || isExtraMeasure(gm)) continue;
        fn(gm, si);
      }
    }
  } else {
    for (let si = 0; si < dim0; si += 1) {
      for (let mi = 0; mi < dim1; mi += 1) {
        const gm = list[si]?.[mi];
        if (!gm || isExtraMeasure(gm)) continue;
        fn(gm, si);
      }
    }
  }
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

export function removeMeasureClickOverlays(host: HTMLElement): void {
  host.querySelectorAll(`[${CLICK_LAYER_ATTR}]`).forEach((el) => el.remove());
}

export function removeMeasureHover(host: HTMLElement): void {
  host.querySelectorAll(`[${HOVER_LAYER_ATTR}]`).forEach((el) => el.remove());
}

export function drawOsmdMeasureHover(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  info: OsmdMeasureClickInfo | null,
): void {
  removeMeasureHover(host);
  if (!info || !osmd.IsReadyToRender()) return;
  const gm = findMeasureGraphic(osmd, info.measureMxl, info.staffIndex);
  if (!gm) return;
  const bounds = boundsForMeasure(gm, host, osmd);
  if (!bounds) return;
  paintBounds(
    host,
    bounds,
    HOVER_LAYER_ATTR,
    'border:2px solid #42a5f5;background:rgba(66,165,245,0.18);border-radius:2px;box-sizing:border-box;',
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

  const info: OsmdMeasureClickInfo = {
    measureMxl,
    staffIndex: staffIndex ?? 0,
  };
  const gm = findMeasureGraphic(osmd, measureMxl, info.staffIndex);
  if (!gm) return;
  const bounds = boundsForMeasure(gm, host, osmd);
  if (!bounds) return;
  paintBounds(
    host,
    bounds,
    HIGHLIGHT_LAYER_ATTR,
    'border:2px solid #1565c0;background:rgba(21,101,192,0.14);border-radius:2px;box-sizing:border-box;',
  );
}

export function installMeasureClickOverlays(host: HTMLElement, _osmd: OpenSheetMusicDisplay): number {
  removeMeasureClickOverlays(host);
  return 0;
}

/** 클릭 위치에서 마디 판정 (OSMD GetNearestStaffEntry 우선) */
export function hitTestOsmdMeasure(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  evt: MouseEvent,
): OsmdMeasureClickInfo | null {
  void host;
  if (!osmd.IsReadyToRender()) return null;
  return hitViaNearestStaffEntry(osmd, evt);
}

export function resolveMeasureAtPointer(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  evt: MouseEvent,
): OsmdMeasureClickInfo | null {
  void host;
  return hitTestOsmdMeasure(osmd, host, evt);
}
