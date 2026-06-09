import { PointF2D, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type OsmdMeasureClickInfo = {
  measureMxl: number;
  staffIndex: number;
};

type GraphicalMeasureLike = {
  IsExtraGraphicalMeasure?: boolean;
  MeasureNumber?: number;
  staffEntries?: unknown[];
  parentSourceMeasure?: {
    MeasureNumberXML?: number;
    MeasureNumber?: number;
  };
  parentMeasure?: GraphicalMeasureLike;
  PositionAndShape?: {
    AbsolutePosition?: { x: number; y: number };
    Size?: { width: number; height: number };
    BoundingRectangle?: { x: number; y: number; width: number; height: number };
    BoundingMarginRectangle?: { x: number; y: number; width: number; height: number };
  };
};

type OsmdGraphicLike = {
  MeasureList?: GraphicalMeasureLike[][];
  NumberOfStaves?: number;
  getClickedObject?: <T>(pt: PointF2D) => T;
  findGraphicalMeasureByMeasureNumber?: (
    measureNumber: number,
    staffIndex: number,
  ) => GraphicalMeasureLike | undefined;
};

function sheetPointFromEvent(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  evt: MouseEvent,
): PointF2D {
  const zoom = osmd.zoom || 1;
  const svg = host.querySelector('svg');
  const target = (svg ?? host) as HTMLElement;
  const rect = target.getBoundingClientRect();
  return new PointF2D((evt.clientX - rect.left) / zoom, (evt.clientY - rect.top) / zoom);
}

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
  if (!Array.isArray(gm.staffEntries) || gm.staffEntries.length < 1) return false;
  return measureMxlFromGraphic(gm) > 0;
}

function measureBounds(
  gm: GraphicalMeasureLike,
): { left: number; top: number; right: number; bottom: number } | null {
  const bb = gm.PositionAndShape;
  if (!bb) return null;
  const rect = bb.BoundingRectangle ?? bb.BoundingMarginRectangle;
  if (rect && rect.width > 2 && rect.height > 2) {
    return {
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    };
  }
  const pos = bb.AbsolutePosition;
  const size = bb.Size;
  if (pos && size && size.width > 2 && size.height > 2) {
    return {
      left: pos.x,
      top: pos.y,
      right: pos.x + size.width,
      bottom: pos.y + size.height,
    };
  }
  return null;
}

/** OSMD MeasureList는 [measureIndex][staffIndex] (첫 축=마디, 둘째=스태프). */
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

function measureFromClickedObject(clicked: unknown): GraphicalMeasureLike | null {
  let cur: unknown = clicked;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 16 && cur && !seen.has(cur); depth += 1) {
    seen.add(cur);
    if (isStaffGraphicalMeasure(cur as GraphicalMeasureLike)) {
      return cur as GraphicalMeasureLike;
    }
    if (typeof cur === 'object' && cur !== null) {
      if ('parentMeasure' in cur) {
        const pm = (cur as { parentMeasure?: unknown }).parentMeasure;
        if (pm && isStaffGraphicalMeasure(pm as GraphicalMeasureLike)) {
          return pm as GraphicalMeasureLike;
        }
        if (pm) {
          cur = pm;
          continue;
        }
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

function hitTestByBounds(
  graphic: OsmdGraphicLike,
  x: number,
  y: number,
): OsmdMeasureClickInfo | null {
  let best: OsmdMeasureClickInfo | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  forEachStaffMeasure(graphic, (gm, staffIndex) => {
    const bounds = measureBounds(gm);
    if (!bounds) return;
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return;
    const measureMxl = measureMxlFromGraphic(gm);
    if (!measureMxl) return;
    const w = bounds.right - bounds.left;
    const h = bounds.bottom - bounds.top;
    if (h > 400 || w > 1200) return;
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      best = { measureMxl, staffIndex };
    }
  });

  return best;
}

export function hitTestOsmdMeasure(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  evt: MouseEvent,
): OsmdMeasureClickInfo | null {
  const graphic = (osmd as { graphic?: OsmdGraphicLike }).graphic;
  if (!graphic?.MeasureList?.length) return null;

  const pt = sheetPointFromEvent(host, osmd, evt);

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
      /* bounds fallback */
    }
  }

  return hitTestByBounds(graphic, pt.x, pt.y);
}

export function drawOsmdMeasureHighlight(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  measureMxl: number | null | undefined,
): void {
  host.querySelectorAll('[data-omr-measure-highlight]').forEach((el) => el.remove());
  if (!measureMxl || measureMxl < 1) return;

  const graphic = (osmd as { graphic?: OsmdGraphicLike }).graphic;
  if (!graphic?.MeasureList?.length) return;

  const zoom = osmd.zoom || 1;
  const svg = host.querySelector('svg');
  const origin = svg?.getBoundingClientRect() ?? host.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const offsetX = origin.left - hostRect.left;
  const offsetY = origin.top - hostRect.top;

  const overlay = document.createElement('div');
  overlay.setAttribute('data-omr-measure-highlight', '1');
  overlay.style.cssText =
    'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:4;';
  host.style.position = host.style.position || 'relative';

  forEachStaffMeasure(graphic, (gm, _staffIndex) => {
    if (measureMxlFromGraphic(gm) !== measureMxl) return;
    const bounds = measureBounds(gm);
    if (!bounds) return;
    const rect = document.createElement('div');
    rect.style.cssText = [
      'position:absolute',
      `left:${offsetX + bounds.left * zoom}px`,
      `top:${offsetY + bounds.top * zoom}px`,
      `width:${(bounds.right - bounds.left) * zoom}px`,
      `height:${(bounds.bottom - bounds.top) * zoom}px`,
      'border:2px solid #1565c0',
      'background:rgba(21,101,192,0.12)',
      'border-radius:2px',
      'box-sizing:border-box',
    ].join(';');
    overlay.appendChild(rect);
  });

  if (overlay.childElementCount > 0) {
    host.appendChild(overlay);
  }
}
