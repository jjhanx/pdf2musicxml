import { PointF2D, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type OsmdMeasureClickInfo = {
  /** MusicXML measure@number (API·편집용) */
  measureMxl: number;
  staffIndex: number;
  /** 악보에 인쇄된 마디 번호(있으면). 없으면 UI에서 measureOffset으로 추정 */
  measurePrinted?: number;
};

/** host 기준 CSS 픽셀 */
type HostBounds = { left: number; top: number; right: number; bottom: number };

type MeasureHitTarget = {
  measureMxl: number;
  measurePrinted: number;
  staffIndex: number;
  bounds: HostBounds;
};

type GraphicalMeasureLike = Record<string, unknown>;

type OsmdGraphicLike = {
  MeasureList?: GraphicalMeasureLike[][];
  NumberOfStaves?: number;
  MusicPages?: unknown[];
  getClickedObject?: <T>(pt: PointF2D) => T;
  domToSvg?: (pt: PointF2D) => PointF2D;
};

const CLICK_LAYER_ATTR = 'data-omr-measure-click-layer';
const HIGHLIGHT_LAYER_ATTR = 'data-omr-measure-highlight';
const OSMD_DEFAULT_UNIT_IN_PIXELS = 10;
const MAX_MEASURE_WIDTH_OSMD = 180;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

export function getOsmdUnitInPixels(osmd: OpenSheetMusicDisplay): number {
  const raw = osmd as unknown as Record<string, unknown>;
  const graphic = asRecord(raw.graphic ?? raw.GraphicSheet);
  const rules = asRecord(raw.rules ?? raw.engravingRules ?? raw.EngravingRules ?? graphic?.rules);
  const uip = rules?.unitInPixels;
  if (typeof uip === 'number' && uip > 0) return uip;
  return OSMD_DEFAULT_UNIT_IN_PIXELS;
}

function readGraphic(osmd: OpenSheetMusicDisplay): OsmdGraphicLike | null {
  const raw = osmd as unknown as Record<string, unknown>;
  const sheet = asRecord(raw.graphic ?? raw.GraphicSheet);
  if (!sheet) return null;

  const measureList = (sheet.MeasureList ?? sheet.measureList) as GraphicalMeasureLike[][] | undefined;
  const musicPages = (sheet.MusicPages ?? sheet.musicPages) as unknown[] | undefined;
  const numberOfStaves = (sheet.NumberOfStaves ?? sheet.numberOfStaves) as number | undefined;
  const getClickedObject = sheet.getClickedObject;
  const domToSvg = sheet.domToSvg;

  return {
    MeasureList: measureList,
    MusicPages: musicPages,
    NumberOfStaves: numberOfStaves,
    getClickedObject:
      typeof getClickedObject === 'function'
        ? (getClickedObject as OsmdGraphicLike['getClickedObject']).bind(sheet)
        : undefined,
    domToSvg:
      typeof domToSvg === 'function'
        ? (domToSvg as OsmdGraphicLike['domToSvg']).bind(sheet)
        : undefined,
  };
}

function isExtraMeasure(gm: GraphicalMeasureLike | null | undefined): boolean {
  if (!gm) return true;
  return Boolean(gm.IsExtraGraphicalMeasure ?? gm.isExtraGraphicalMeasure);
}

function readSourceMeasure(gm: GraphicalMeasureLike): Record<string, unknown> | null {
  return asRecord(gm.parentSourceMeasure ?? gm.ParentSourceMeasure);
}

function readNumberField(obj: Record<string, unknown> | null, keys: string[]): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return Math.floor(v);
    }
  }
  return null;
}

/** MusicXML measure@number — API·편집에 사용 */
export function measureMxlFromGraphic(gm: GraphicalMeasureLike): number {
  const sm = readSourceMeasure(gm);
  const xml = readNumberField(sm, ['MeasureNumberXML', 'measureNumberXML']);
  if (xml != null) return xml;
  const onGm = readNumberField(gm, ['MeasureNumberXML', 'measureNumberXML', 'MeasureNumber', 'measureNumber']);
  return onGm ?? 0;
}

/** 악보에 보이는 마디 번호(OSMD MeasureNumber). 없으면 XML 번호 */
export function measurePrintedFromGraphic(gm: GraphicalMeasureLike): number {
  const sm = readSourceMeasure(gm);
  const display = readNumberField(sm, ['MeasureNumber', 'measureNumber']);
  if (display != null && display > 0) return display;
  const onGm = readNumberField(gm, ['MeasureNumber', 'measureNumber']);
  if (onGm != null && onGm > 0) return onGm;
  const mxl = measureMxlFromGraphic(gm);
  return mxl > 0 ? mxl : 0;
}

function readPositionAndShape(obj: unknown): Record<string, unknown> | null {
  const rec = asRecord(obj);
  if (!rec) return null;
  return asRecord(rec.PositionAndShape ?? rec.positionAndShape);
}

function absolutePosition(obj: unknown): { x: number; y: number } | null {
  const bb = readPositionAndShape(obj);
  if (!bb) return null;
  const pos = asRecord(bb.AbsolutePosition ?? bb.absolutePosition);
  if (!pos) return null;
  const x = Number(pos.x);
  const y = Number(pos.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function osmdGraphicBounds(obj: unknown): HostBounds | null {
  const bb = readPositionAndShape(obj);
  if (!bb) return null;
  const pos = asRecord(bb.AbsolutePosition ?? bb.absolutePosition);
  const size = asRecord(bb.Size ?? bb.size);
  if (pos && size) {
    const x = Number(pos.x);
    const y = Number(pos.y);
    const w = Number(size.width);
    const h = Number(size.height);
    if (Number.isFinite(x) && Number.isFinite(y) && w > 0.5 && h > 0.5) {
      return { left: x, top: y, right: x + w, bottom: y + h };
    }
  }
  return null;
}

function graphicBoundsToHost(
  bounds: HostBounds,
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): HostBounds {
  const unit = getOsmdUnitInPixels(osmd);
  const zoom = osmd.zoom || 1;
  const scale = unit * zoom;
  const { offsetX, offsetY } = getOsmdHostLayout(host, osmd);
  return {
    left: offsetX + bounds.left * scale,
    top: offsetY + bounds.top * scale,
    right: offsetX + bounds.right * scale,
    bottom: offsetY + bounds.bottom * scale,
  };
}

function horizontalSpanOsmd(
  gm: GraphicalMeasureLike,
  nextGm: GraphicalMeasureLike | undefined,
  fallbackWidth: number,
): { left: number; width: number } | null {
  const pos = absolutePosition(gm);
  if (!pos) return null;
  const nextPos = nextGm ? absolutePosition(nextGm) : null;
  if (nextPos && nextPos.x > pos.x + 0.5) {
    const width = nextPos.x - pos.x;
    if (width > 0.5 && width <= MAX_MEASURE_WIDTH_OSMD) {
      return { left: pos.x, width };
    }
  }
  const bb = readPositionAndShape(gm);
  const size = asRecord(bb?.Size ?? bb?.size);
  const rawW = size ? Number(size.width) : NaN;
  const width =
    Number.isFinite(rawW) && rawW > 0.5 && rawW <= MAX_MEASURE_WIDTH_OSMD
      ? rawW
      : fallbackWidth > 0.5
        ? fallbackWidth
        : 0;
  if (width <= 0.5) return null;
  return { left: pos.x, width };
}

function medianNeighborWidthOsmd(row: GraphicalMeasureLike[]): number {
  const widths: number[] = [];
  for (let i = 0; i < row.length - 1; i += 1) {
    const a = absolutePosition(row[i]);
    const b = absolutePosition(row[i + 1]);
    if (a && b && b.x > a.x) {
      const w = b.x - a.x;
      if (w > 0.5 && w <= MAX_MEASURE_WIDTH_OSMD) widths.push(w);
    }
  }
  if (!widths.length) return 28;
  widths.sort((x, y) => x - y);
  return widths[Math.floor(widths.length / 2)];
}

function staffVerticalBoundsOsmd(
  system: Record<string, unknown>,
  staffIndex: number,
  gm: GraphicalMeasureLike,
): HostBounds | null {
  const staffLines = (system.StaffLines ?? system.staffLines) as unknown[] | undefined;
  const staffLine = staffLines?.[staffIndex];
  const staffBounds = staffLine ? osmdGraphicBounds(staffLine) : null;
  if (staffBounds) return staffBounds;
  return osmdGraphicBounds(gm);
}

function measureBoundsInHost(
  gm: GraphicalMeasureLike,
  nextGm: GraphicalMeasureLike | undefined,
  system: Record<string, unknown> | null,
  staffIndex: number,
  row: GraphicalMeasureLike[],
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): HostBounds | null {
  const fallbackW = medianNeighborWidthOsmd(row);
  const hSpan = horizontalSpanOsmd(gm, nextGm, fallbackW);
  if (!hSpan) return null;

  const vertical =
    system != null ? staffVerticalBoundsOsmd(system, staffIndex, gm) : osmdGraphicBounds(gm);
  if (!vertical) return null;

  const osmdBounds: HostBounds = {
    left: hSpan.left,
    top: vertical.top,
    right: hSpan.left + hSpan.width,
    bottom: vertical.bottom,
  };
  return graphicBoundsToHost(osmdBounds, host, osmd);
}

function forEachGraphicalMeasure(
  osmd: OpenSheetMusicDisplay,
  fn: (
    gm: GraphicalMeasureLike,
    staffIndex: number,
    measureIndex: number,
    row: GraphicalMeasureLike[],
    system: Record<string, unknown> | null,
  ) => void,
): void {
  const graphic = readGraphic(osmd);
  if (!graphic) return;

  let fromPages = 0;
  for (const page of graphic.MusicPages ?? []) {
    const pageRec = asRecord(page);
    if (!pageRec) continue;
    const systems = (pageRec.MusicSystems ?? pageRec.musicSystems) as unknown[] | undefined;
    for (const system of systems ?? []) {
      const sysRec = asRecord(system);
      if (!sysRec) continue;
      const rows = (sysRec.GraphicalMeasures ?? sysRec.graphicalMeasures) as GraphicalMeasureLike[][] | undefined;
      for (let staffIndex = 0; staffIndex < (rows?.length ?? 0); staffIndex += 1) {
        const row = rows?.[staffIndex] ?? [];
        for (let measureIndex = 0; measureIndex < row.length; measureIndex += 1) {
          const gm = row[measureIndex];
          if (!gm || isExtraMeasure(gm)) continue;
          fn(gm, staffIndex, measureIndex, row, sysRec);
          fromPages += 1;
        }
      }
    }
  }
  if (fromPages > 0) return;

  const list = graphic.MeasureList;
  if (!list?.length) return;

  const dim0 = list.length;
  const dim1 = list[0]?.length ?? 0;
  const numStaves = graphic.NumberOfStaves ?? 0;
  const measureMajor =
    numStaves > 0
      ? dim1 === numStaves || (dim1 <= numStaves + 1 && dim0 > dim1)
      : dim0 >= dim1;

  if (measureMajor) {
    for (let si = 0; si < dim1; si += 1) {
      const staffRow = Array.from({ length: dim0 }, (_, i) => list[i]?.[si]).filter(
        (g): g is GraphicalMeasureLike => Boolean(g) && !isExtraMeasure(g),
      );
      for (let mi = 0; mi < dim0; mi += 1) {
        const gm = list[mi]?.[si];
        if (!gm || isExtraMeasure(gm)) continue;
        const idxInRow = staffRow.indexOf(gm);
        fn(gm, si, idxInRow >= 0 ? idxInRow : mi, staffRow, null);
      }
    }
    return;
  }

  for (let si = 0; si < dim0; si += 1) {
    const row = list[si] ?? [];
    for (let mi = 0; mi < dim1; mi += 1) {
      const gm = list[si]?.[mi];
      if (!gm || isExtraMeasure(gm)) continue;
      fn(gm, si, mi, row, null);
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

  forEachGraphicalMeasure(osmd, (gm, staffIndex, measureIndex, row, system) => {
    const measureMxl = measureMxlFromGraphic(gm);
    if (!measureMxl) return;
    const measurePrinted = measurePrintedFromGraphic(gm) || measureMxl;
    const nextGm = row[measureIndex + 1];
    const bounds = measureBoundsInHost(gm, nextGm, system, staffIndex, row, host, osmd);
    if (!bounds) return;
    const w = bounds.right - bounds.left;
    const h = bounds.bottom - bounds.top;
    if (w < 4 || h < 4) return;
    const key = `${measureMxl}|${staffIndex}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ measureMxl, measurePrinted, staffIndex, bounds });
  });

  return out;
}

export function getOsmdHostLayout(host: HTMLElement, _osmd: OpenSheetMusicDisplay): {
  offsetX: number;
  offsetY: number;
  zoom: number;
} {
  const svg = host.querySelector('svg');
  const origin = svg?.getBoundingClientRect() ?? host.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  return {
    offsetX: origin.left - hostRect.left,
    offsetY: origin.top - hostRect.top,
    zoom: _osmd.zoom || 1,
  };
}

export function removeMeasureClickOverlays(host: HTMLElement): void {
  host.querySelectorAll(`[${CLICK_LAYER_ATTR}]`).forEach((el) => el.remove());
}

export function installMeasureClickOverlays(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  onClick: (info: OsmdMeasureClickInfo) => void,
): number {
  removeMeasureClickOverlays(host);
  if (!osmd.IsReadyToRender()) return 0;

  const targets = collectMeasureHitTargets(osmd, host);
  if (!targets.length) return 0;

  host.style.position = host.style.position || 'relative';

  const layer = document.createElement('div');
  layer.setAttribute(CLICK_LAYER_ATTR, '1');
  const layerHeight = Math.max(host.scrollHeight, host.clientHeight, host.offsetHeight);
  layer.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    'width:100%',
    `height:${layerHeight}px`,
    'z-index:6',
    'pointer-events:none',
  ].join(';');

  for (const target of targets) {
    const left = target.bounds.left;
    const top = target.bounds.top;
    const width = target.bounds.right - target.bounds.left;
    const height = target.bounds.bottom - target.bounds.top;
    if (width < 4 || height < 4) continue;

    const hit = document.createElement('button');
    hit.type = 'button';
    hit.setAttribute('data-omr-measure-target', String(target.measureMxl));
    hit.setAttribute('data-omr-staff-index', String(target.staffIndex));
    hit.setAttribute(
      'aria-label',
      `마디 ${target.measurePrinted > 0 ? target.measurePrinted : target.measureMxl} 편집`,
    );
    hit.style.cssText = [
      'position:absolute',
      'border:none',
      'padding:0',
      'margin:0',
      `left:${left}px`,
      `top:${top}px`,
      `width:${width}px`,
      `height:${height}px`,
      'pointer-events:auto',
      'cursor:pointer',
      'background:transparent',
      'border-radius:2px',
      'box-sizing:border-box',
      'z-index:6',
    ].join(';');

    hit.addEventListener('mouseenter', () => {
      hit.style.background = 'rgba(21,101,192,0.16)';
      hit.style.outline = '1px solid rgba(21,101,192,0.5)';
    });
    hit.addEventListener('mouseleave', () => {
      hit.style.background = 'transparent';
      hit.style.outline = 'none';
    });
    hit.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      onClick({
        measureMxl: target.measureMxl,
        staffIndex: target.staffIndex,
        measurePrinted: target.measurePrinted,
      });
    });

    layer.appendChild(hit);
  }

  if (layer.childElementCount === 0) return 0;
  host.appendChild(layer);
  return layer.childElementCount;
}

function sheetPointFromEvent(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  evt: MouseEvent,
  graphic?: OsmdGraphicLike | null,
): PointF2D {
  const layout = getOsmdHostLayout(host, osmd);
  const hostRect = host.getBoundingClientRect();
  const unit = getOsmdUnitInPixels(osmd);
  const scale = unit * layout.zoom;
  const x = (evt.clientX - hostRect.left - layout.offsetX) / scale;
  const y = (evt.clientY - hostRect.top - layout.offsetY) / scale;
  const pt = new PointF2D(x, y);
  if (graphic?.domToSvg) {
    try {
      return graphic.domToSvg(pt);
    } catch {
      /* use raw pt */
    }
  }
  return pt;
}

function pointInHostBounds(x: number, y: number, bounds: HostBounds): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function measureFromClickedObject(clicked: unknown): GraphicalMeasureLike | null {
  let cur: unknown = clicked;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 16 && cur && !seen.has(cur); depth += 1) {
    seen.add(cur);
    const rec = asRecord(cur);
    if (!rec) break;
    if (!isExtraMeasure(rec) && measureMxlFromGraphic(rec) > 0) {
      return rec;
    }
    const pm = rec.parentMeasure ?? rec.ParentMeasure;
    if (pm) {
      cur = pm;
      continue;
    }
    break;
  }
  return null;
}

function staffIndexForMeasure(graphic: OsmdGraphicLike, gm: GraphicalMeasureLike): number {
  const list = graphic.MeasureList;
  if (!list?.length) return 0;

  const dim0 = list.length;
  const dim1 = list[0]?.length ?? 0;
  const numStaves = graphic.NumberOfStaves ?? 0;
  const measureMajor =
    numStaves > 0
      ? dim1 === numStaves || (dim1 <= numStaves + 1 && dim0 > dim1)
      : dim0 >= dim1;

  if (measureMajor) {
    for (let mi = 0; mi < dim0; mi += 1) {
      for (let si = 0; si < dim1; si += 1) {
        if (list[mi]?.[si] === gm) return si;
      }
    }
  } else {
    for (let si = 0; si < dim0; si += 1) {
      for (let mi = 0; mi < dim1; mi += 1) {
        if (list[si]?.[mi] === gm) return si;
      }
    }
  }
  return 0;
}

function targetToClickInfo(t: MeasureHitTarget): OsmdMeasureClickInfo {
  return {
    measureMxl: t.measureMxl,
    staffIndex: t.staffIndex,
    measurePrinted: t.measurePrinted,
  };
}

/** 좌표·DOM 폴백 클릭 판정 */
export function hitTestOsmdMeasure(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  evt: MouseEvent,
): OsmdMeasureClickInfo | null {
  const hostRect = host.getBoundingClientRect();
  const clickX = evt.clientX - hostRect.left;
  const clickY = evt.clientY - hostRect.top;

  const targets = collectMeasureHitTargets(osmd, host);
  let best: MeasureHitTarget | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const t of targets) {
    if (!pointInHostBounds(clickX, clickY, t.bounds)) continue;
    const area = (t.bounds.right - t.bounds.left) * (t.bounds.bottom - t.bounds.top);
    if (area < bestArea) {
      bestArea = area;
      best = t;
    }
  }
  if (best) return targetToClickInfo(best);

  const graphic = readGraphic(osmd);
  if (!graphic) return null;
  const pt = sheetPointFromEvent(host, osmd, evt, graphic);

  if (typeof graphic.getClickedObject === 'function') {
    try {
      const clicked = graphic.getClickedObject(pt);
      const gm = measureFromClickedObject(clicked);
      if (gm) {
        const measureMxl = measureMxlFromGraphic(gm);
        if (measureMxl > 0) {
          return {
            measureMxl,
            staffIndex: staffIndexForMeasure(graphic, gm),
            measurePrinted: measurePrintedFromGraphic(gm) || undefined,
          };
        }
      }
    } catch {
      /* fall through */
    }
  }

  return null;
}

export function drawOsmdMeasureHighlight(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  measureMxl: number | null | undefined,
  staffIndex?: number | null,
): void {
  host.querySelectorAll(`[${HIGHLIGHT_LAYER_ATTR}]`).forEach((el) => el.remove());
  if (!measureMxl || measureMxl < 1) return;

  let targets = collectMeasureHitTargets(osmd, host).filter((t) => t.measureMxl === measureMxl);
  if (staffIndex != null && staffIndex >= 0) {
    targets = targets.filter((t) => t.staffIndex === staffIndex);
  }
  if (!targets.length) return;

  host.style.position = host.style.position || 'relative';

  const overlay = document.createElement('div');
  overlay.setAttribute(HIGHLIGHT_LAYER_ATTR, '1');
  overlay.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;';

  for (const target of targets) {
    const rect = document.createElement('div');
    rect.style.cssText = [
      'position:absolute',
      `left:${target.bounds.left}px`,
      `top:${target.bounds.top}px`,
      `width:${target.bounds.right - target.bounds.left}px`,
      `height:${target.bounds.bottom - target.bounds.top}px`,
      'border:2px solid #1565c0',
      'background:rgba(21,101,192,0.12)',
      'border-radius:2px',
      'box-sizing:border-box',
    ].join(';');
    overlay.appendChild(rect);
  }

  if (overlay.childElementCount > 0) {
    host.appendChild(overlay);
  }
}
