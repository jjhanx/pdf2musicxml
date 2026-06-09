import { PointF2D, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type OsmdMeasureClickInfo = {
  measureMxl: number;
  staffIndex: number;
};

type MeasureBounds = { left: number; top: number; right: number; bottom: number };

type MeasureHitTarget = {
  measureMxl: number;
  staffIndex: number;
  bounds: MeasureBounds;
};

type GraphicalMeasureLike = {
  IsExtraGraphicalMeasure?: boolean;
  MeasureNumber?: number;
  parentSourceMeasure?: {
    MeasureNumberXML?: number;
    MeasureNumber?: number;
  };
  PositionAndShape?: {
    AbsolutePosition?: { x: number; y: number };
    Size?: { width: number; height: number };
    BoundingRectangle?: { x: number; y: number; width: number; height: number };
    BoundingMarginRectangle?: { x: number; y: number; width: number; height: number };
  };
};

type MusicSystemLike = {
  StaffLines?: { PositionAndShape?: GraphicalMeasureLike['PositionAndShape'] }[];
  GraphicalMeasures?: GraphicalMeasureLike[][];
};

type MusicPageLike = {
  MusicSystems?: MusicSystemLike[];
};

type OsmdGraphicLike = {
  MeasureList?: GraphicalMeasureLike[][];
  NumberOfStaves?: number;
  MusicPages?: MusicPageLike[];
  getClickedObject?: <T>(pt: PointF2D) => T;
  domToSvg?: (pt: PointF2D) => PointF2D;
};

function readGraphic(osmd: OpenSheetMusicDisplay): OsmdGraphicLike | null {
  const raw = osmd as unknown as Record<string, unknown>;
  const sheet = (raw.graphic ?? raw.GraphicSheet) as Record<string, unknown> | undefined;
  if (!sheet || typeof sheet !== 'object') return null;

  const measureList = (sheet.MeasureList ?? sheet.measureList) as GraphicalMeasureLike[][] | undefined;
  const musicPages = (sheet.MusicPages ?? sheet.musicPages) as MusicPageLike[] | undefined;
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

const CLICK_LAYER_ATTR = 'data-omr-measure-click-layer';
const HIGHLIGHT_LAYER_ATTR = 'data-omr-measure-highlight';

function measureMxlFromGraphic(gm: GraphicalMeasureLike): number {
  if (typeof gm.MeasureNumber === 'number' && gm.MeasureNumber > 0) {
    return Math.floor(gm.MeasureNumber);
  }
  const sm = gm.parentSourceMeasure;
  if (!sm) return 0;
  if (typeof sm.MeasureNumberXML === 'number' && sm.MeasureNumberXML > 0) {
    return Math.floor(sm.MeasureNumberXML);
  }
  if (typeof sm.MeasureNumber === 'number' && sm.MeasureNumber > 0) {
    return Math.floor(sm.MeasureNumber);
  }
  return 0;
}

function isStaffGraphicalMeasure(gm: GraphicalMeasureLike | null | undefined): gm is GraphicalMeasureLike {
  if (!gm || gm.IsExtraGraphicalMeasure) return false;
  return measureMxlFromGraphic(gm) > 0;
}

function readPositionAndShape(obj: unknown): GraphicalMeasureLike['PositionAndShape'] | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  const ps = rec.PositionAndShape ?? rec.positionAndShape;
  return (ps as GraphicalMeasureLike['PositionAndShape']) ?? null;
}

export function measureBounds(
  obj: { PositionAndShape?: GraphicalMeasureLike['PositionAndShape'] },
): MeasureBounds | null {
  const bb = readPositionAndShape(obj);
  if (!bb) return null;
  const rect =
    bb.BoundingRectangle ??
    (bb as { boundingRectangle?: typeof bb.BoundingRectangle }).boundingRectangle ??
    bb.BoundingMarginRectangle ??
    (bb as { boundingMarginRectangle?: typeof bb.BoundingMarginRectangle }).boundingMarginRectangle;
  if (rect && rect.width > 0.5 && rect.height > 0.5) {
    return {
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    };
  }
  const pos = bb.AbsolutePosition ?? (bb as { absolutePosition?: { x: number; y: number } }).absolutePosition;
  const size = bb.Size ?? (bb as { size?: { width: number; height: number } }).size;
  if (pos && size && size.width > 0.5 && size.height > 0.5) {
    return {
      left: pos.x,
      top: pos.y,
      right: pos.x + size.width,
      bottom: pos.y + size.height,
    };
  }
  return null;
}

function measureBoundsFromGraphicMeasure(gm: GraphicalMeasureLike): MeasureBounds | null {
  const direct = measureBounds(gm);
  if (direct) return direct;
  const entries = (gm as { staffEntries?: unknown[] }).staffEntries;
  if (!Array.isArray(entries)) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const b = measureBounds(entry as { PositionAndShape?: GraphicalMeasureLike['PositionAndShape'] });
    if (!b) continue;
    left = Math.min(left, b.left);
    top = Math.min(top, b.top);
    right = Math.max(right, b.right);
    bottom = Math.max(bottom, b.bottom);
  }
  if (!Number.isFinite(left)) return null;
  return { left, top, right, bottom };
}

function forEachStaffMeasure(
  graphic: OsmdGraphicLike,
  fn: (gm: GraphicalMeasureLike, staffIndex: number) => void,
): void {
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
    for (let mi = 0; mi < dim0; mi += 1) {
      for (let si = 0; si < dim1; si += 1) {
        const gm = list[mi]?.[si];
        if (isStaffGraphicalMeasure(gm)) fn(gm, si);
      }
    }
    return;
  }

  for (let si = 0; si < dim0; si += 1) {
    for (let mi = 0; mi < dim1; mi += 1) {
      const gm = list[si]?.[mi];
      if (isStaffGraphicalMeasure(gm)) fn(gm, si);
    }
  }
}

function collectFromMusicPages(graphic: OsmdGraphicLike): MeasureHitTarget[] {
  const out: MeasureHitTarget[] = [];
  const seen = new Set<string>();

  for (const page of graphic.MusicPages ?? []) {
    for (const system of page.MusicSystems ?? []) {
      const rows = system.GraphicalMeasures ?? [];
      for (let staffIndex = 0; staffIndex < rows.length; staffIndex += 1) {
        for (const gm of rows[staffIndex] ?? []) {
          if (!isStaffGraphicalMeasure(gm)) continue;
          const measureMxl = measureMxlFromGraphic(gm);
          const bounds = measureBoundsFromGraphicMeasure(gm);
          if (!measureMxl || !bounds) continue;
          const key = `${measureMxl}|${staffIndex}|${bounds.left}|${bounds.top}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ measureMxl, staffIndex, bounds });
        }
      }
    }
  }
  return out;
}

export function collectMeasureHitTargets(osmd: OpenSheetMusicDisplay): MeasureHitTarget[] {
  const graphic = readGraphic(osmd);
  if (!graphic) return [];

  const fromPages = collectFromMusicPages(graphic);
  if (fromPages.length > 0) return fromPages;

  const out: MeasureHitTarget[] = [];
  const seen = new Set<string>();
  forEachStaffMeasure(graphic, (gm, staffIndex) => {
    const measureMxl = measureMxlFromGraphic(gm);
    const bounds = measureBoundsFromGraphicMeasure(gm);
    if (!measureMxl || !bounds) return;
    const w = bounds.right - bounds.left;
    const h = bounds.bottom - bounds.top;
    if (h > 800 || w > 2000) return;
    const key = `${measureMxl}|${staffIndex}|${bounds.left}|${bounds.top}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ measureMxl, staffIndex, bounds });
  });
  return out;
}

export function getOsmdHostLayout(host: HTMLElement, osmd: OpenSheetMusicDisplay): {
  offsetX: number;
  offsetY: number;
  zoom: number;
} {
  const zoom = osmd.zoom || 1;
  const svg = host.querySelector('svg');
  const origin = svg?.getBoundingClientRect() ?? host.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  return {
    offsetX: origin.left - hostRect.left,
    offsetY: origin.top - hostRect.top,
    zoom,
  };
}

function boundsToCss(
  bounds: MeasureBounds,
  layout: { offsetX: number; offsetY: number; zoom: number },
): { left: number; top: number; width: number; height: number } {
  return {
    left: layout.offsetX + bounds.left * layout.zoom,
    top: layout.offsetY + bounds.top * layout.zoom,
    width: (bounds.right - bounds.left) * layout.zoom,
    height: (bounds.bottom - bounds.top) * layout.zoom,
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

  const targets = collectMeasureHitTargets(osmd);
  if (!targets.length) return 0;

  const layout = getOsmdHostLayout(host, osmd);
  host.style.position = host.style.position || 'relative';

  const layer = document.createElement('div');
  layer.setAttribute(CLICK_LAYER_ATTR, '1');
  layer.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;z-index:5;pointer-events:none;';

  for (const target of targets) {
    const box = boundsToCss(target.bounds, layout);
    if (box.width < 2 || box.height < 2) continue;

    const hit = document.createElement('button');
    hit.type = 'button';
    hit.setAttribute('data-omr-measure-target', String(target.measureMxl));
    hit.setAttribute('data-omr-staff-index', String(target.staffIndex));
    hit.setAttribute('aria-label', `마디 ${target.measureMxl} 편집`);
    hit.style.cssText = [
      'position:absolute',
      'border:none',
      'padding:0',
      'margin:0',
      `left:${box.left}px`,
      `top:${box.top}px`,
      `width:${box.width}px`,
      `height:${box.height}px`,
      'pointer-events:auto',
      'cursor:pointer',
      'background:transparent',
      'border-radius:2px',
      'box-sizing:border-box',
    ].join(';');

    hit.addEventListener('mouseenter', () => {
      hit.style.background = 'rgba(21,101,192,0.14)';
      hit.style.outline = '1px solid rgba(21,101,192,0.45)';
    });
    hit.addEventListener('mouseleave', () => {
      hit.style.background = 'transparent';
      hit.style.outline = 'none';
    });
    hit.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      onClick({ measureMxl: target.measureMxl, staffIndex: target.staffIndex });
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
  const x = (evt.clientX - hostRect.left - layout.offsetX) / layout.zoom;
  const y = (evt.clientY - hostRect.top - layout.offsetY) / layout.zoom;
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

function pointInBounds(x: number, y: number, bounds: MeasureBounds): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function measureFromClickedObject(clicked: unknown): GraphicalMeasureLike | null {
  let cur: unknown = clicked;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 16 && cur && !seen.has(cur); depth += 1) {
    seen.add(cur);
    if (isStaffGraphicalMeasure(cur as GraphicalMeasureLike)) {
      return cur as GraphicalMeasureLike;
    }
    if (typeof cur === 'object' && cur !== null && 'parentMeasure' in cur) {
      const pm = (cur as { parentMeasure?: unknown }).parentMeasure;
      if (pm && isStaffGraphicalMeasure(pm as GraphicalMeasureLike)) {
        return pm as GraphicalMeasureLike;
      }
      if (pm) {
        cur = pm;
        continue;
      }
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

/** 좌표 기반 폴백(오버레이가 비었을 때). */
export function hitTestOsmdMeasure(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  evt: MouseEvent,
): OsmdMeasureClickInfo | null {
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
          return { measureMxl, staffIndex: staffIndexForMeasure(graphic, gm) };
        }
      }
    } catch {
      /* fall through */
    }
  }

  const targets = collectMeasureHitTargets(osmd);
  let best: OsmdMeasureClickInfo | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const t of targets) {
    if (!pointInBounds(pt.x, pt.y, t.bounds)) continue;
    const area = (t.bounds.right - t.bounds.left) * (t.bounds.bottom - t.bounds.top);
    if (area < bestArea) {
      bestArea = area;
      best = { measureMxl: t.measureMxl, staffIndex: t.staffIndex };
    }
  }
  return best;
}

export function drawOsmdMeasureHighlight(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  measureMxl: number | null | undefined,
): void {
  host.querySelectorAll(`[${HIGHLIGHT_LAYER_ATTR}]`).forEach((el) => el.remove());
  if (!measureMxl || measureMxl < 1) return;

  const targets = collectMeasureHitTargets(osmd).filter((t) => t.measureMxl === measureMxl);
  if (!targets.length) return;

  const layout = getOsmdHostLayout(host, osmd);
  host.style.position = host.style.position || 'relative';

  const overlay = document.createElement('div');
  overlay.setAttribute(HIGHLIGHT_LAYER_ATTR, '1');
  overlay.style.cssText =
    'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:4;';

  for (const target of targets) {
    const box = boundsToCss(target.bounds, layout);
    const rect = document.createElement('div');
    rect.style.cssText = [
      'position:absolute',
      `left:${box.left}px`,
      `top:${box.top}px`,
      `width:${box.width}px`,
      `height:${box.height}px`,
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
