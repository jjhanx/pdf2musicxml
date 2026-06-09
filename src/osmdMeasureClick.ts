import { PointF2D, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type OsmdMeasureClickInfo = {
  measureMxl: number;
  staffIndex: number;
};

type GraphicalMeasureLike = {
  IsExtraGraphicalMeasure?: boolean;
  MeasureNumber?: number;
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
  getClickedObject?: <T>(pt: PointF2D) => T;
};

function sheetPointFromEvent(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  evt: MouseEvent,
): PointF2D {
  const rect = host.getBoundingClientRect();
  const zoom = osmd.zoom || 1;
  return new PointF2D(
    (evt.clientX - rect.left + host.scrollLeft) / zoom,
    (evt.clientY - rect.top + host.scrollTop) / zoom,
  );
}

function measureMxlFromGraphic(gm: GraphicalMeasureLike): number {
  if (typeof gm.MeasureNumber === 'number' && gm.MeasureNumber > 0) {
    return gm.MeasureNumber;
  }
  const sm = gm.parentSourceMeasure;
  if (!sm) return 0;
  if (typeof sm.MeasureNumberXML === 'number' && sm.MeasureNumberXML > 0) {
    return sm.MeasureNumberXML;
  }
  if (typeof sm.MeasureNumber === 'number' && sm.MeasureNumber > 0) {
    return sm.MeasureNumber;
  }
  return 0;
}

function measureBounds(
  gm: GraphicalMeasureLike,
): { left: number; top: number; right: number; bottom: number } | null {
  const bb = gm.PositionAndShape;
  if (!bb) return null;
  const rect = bb.BoundingRectangle ?? bb.BoundingMarginRectangle;
  if (rect && rect.width > 0 && rect.height > 0) {
    return {
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    };
  }
  const pos = bb.AbsolutePosition;
  const size = bb.Size;
  if (pos && size && size.width > 0 && size.height > 0) {
    return {
      left: pos.x,
      top: pos.y,
      right: pos.x + size.width,
      bottom: pos.y + size.height,
    };
  }
  return null;
}

function isGraphicalMeasure(obj: unknown): obj is GraphicalMeasureLike {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    ('MeasureNumber' in obj || 'parentSourceMeasure' in obj || 'PositionAndShape' in obj)
  );
}

function measureFromClickedObject(clicked: unknown): GraphicalMeasureLike | null {
  let cur: unknown = clicked;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 12 && cur && !seen.has(cur); depth += 1) {
    seen.add(cur);
    if (isGraphicalMeasure(cur) && !cur.IsExtraGraphicalMeasure) {
      const n = measureMxlFromGraphic(cur);
      if (n > 0) return cur;
    }
    if (typeof cur === 'object' && cur !== null) {
      if ('parentMeasure' in cur) {
        const pm = (cur as { parentMeasure?: unknown }).parentMeasure;
        if (pm) {
          cur = pm;
          continue;
        }
      }
      if ('Parent' in cur) {
        const parent = (cur as { Parent?: unknown }).Parent;
        if (parent) {
          cur = parent;
          continue;
        }
      }
      if ('DataObject' in cur) {
        const data = (cur as { DataObject?: unknown }).DataObject;
        if (data) {
          cur = data;
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
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i] ?? [];
    for (let j = 0; j < row.length; j += 1) {
      if (row[j] === gm) return i;
    }
  }
  for (let j = 0; j < (list[0]?.length ?? 0); j += 1) {
    for (let i = 0; i < list.length; i += 1) {
      if (list[i]?.[j] === gm) return i;
    }
  }
  return 0;
}

function hitTestByBounds(
  graphic: OsmdGraphicLike,
  x: number,
  y: number,
): OsmdMeasureClickInfo | null {
  const measureList = graphic.MeasureList;
  if (!measureList?.length) return null;

  let best: OsmdMeasureClickInfo | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (let staffIndex = 0; staffIndex < measureList.length; staffIndex += 1) {
    for (const gm of measureList[staffIndex] ?? []) {
      if (!gm || gm.IsExtraGraphicalMeasure) continue;
      const bounds = measureBounds(gm);
      if (!bounds) continue;
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue;
      const measureMxl = measureMxlFromGraphic(gm);
      if (!measureMxl) continue;
      const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
      if (area <= bestArea) {
        bestArea = area;
        best = { measureMxl, staffIndex };
      }
    }
  }
  return best;
}

export function hitTestOsmdMeasure(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  evt: MouseEvent,
): OsmdMeasureClickInfo | null {
  const graphic = (osmd as { graphic?: OsmdGraphicLike }).graphic;
  if (!graphic) return null;

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
  const measureList = graphic?.MeasureList;
  if (!measureList?.length) return;

  const zoom = osmd.zoom || 1;
  const overlay = document.createElement('div');
  overlay.setAttribute('data-omr-measure-highlight', '1');
  overlay.style.cssText =
    'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:4;';
  host.style.position = host.style.position || 'relative';

  for (const staffMeasures of measureList) {
    for (const gm of staffMeasures ?? []) {
      if (!gm || gm.IsExtraGraphicalMeasure) continue;
      if (measureMxlFromGraphic(gm) !== measureMxl) continue;
      const bounds = measureBounds(gm);
      if (!bounds) continue;
      const rect = document.createElement('div');
      rect.style.cssText = [
        'position:absolute',
        `left:${bounds.left * zoom}px`,
        `top:${bounds.top * zoom}px`,
        `width:${(bounds.right - bounds.left) * zoom}px`,
        `height:${(bounds.bottom - bounds.top) * zoom}px`,
        'border:2px solid #1565c0',
        'background:rgba(21,101,192,0.08)',
        'border-radius:2px',
        'box-sizing:border-box',
      ].join(';');
      overlay.appendChild(rect);
    }
  }
  if (overlay.childElementCount > 0) {
    host.appendChild(overlay);
  }
}
