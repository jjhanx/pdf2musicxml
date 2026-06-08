import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type OsmdMeasureClickInfo = {
  measureMxl: number;
  staffIndex: number;
};

type GraphicalMeasureLike = {
  IsExtraGraphicalMeasure?: boolean;
  parentSourceMeasure?: {
    MeasureNumberXML?: number;
    MeasureNumber?: number;
    getPrintedMeasureNumber?: () => number;
  };
  PositionAndShape?: {
    AbsolutePosition?: { x: number; y: number };
    Size?: { width: number; height: number };
  };
};

function sheetPointFromEvent(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  evt: MouseEvent,
): { x: number; y: number } {
  const rect = host.getBoundingClientRect();
  const zoom = osmd.zoom || 1;
  return {
    x: (evt.clientX - rect.left + host.scrollLeft) / zoom,
    y: (evt.clientY - rect.top + host.scrollTop) / zoom,
  };
}

function measureMxlFromGraphic(gm: GraphicalMeasureLike): number {
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

export function hitTestOsmdMeasure(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  evt: MouseEvent,
): OsmdMeasureClickInfo | null {
  const graphic = (osmd as { graphic?: { MeasureList?: GraphicalMeasureLike[][] } }).graphic;
  const measureList = graphic?.MeasureList;
  if (!measureList?.length) return null;

  const { x, y } = sheetPointFromEvent(host, osmd, evt);
  let best: OsmdMeasureClickInfo | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (let staffIndex = 0; staffIndex < measureList.length; staffIndex += 1) {
    for (const gm of measureList[staffIndex] ?? []) {
      if (gm.IsExtraGraphicalMeasure) continue;
      const bb = gm.PositionAndShape;
      const pos = bb?.AbsolutePosition;
      const size = bb?.Size;
      if (!pos || !size || size.width <= 0 || size.height <= 0) continue;
      const left = pos.x;
      const top = pos.y;
      const right = left + size.width;
      const bottom = top + size.height;
      if (x < left || x > right || y < top || y > bottom) continue;
      const area = size.width * size.height;
      const measureMxl = measureMxlFromGraphic(gm);
      if (!measureMxl) continue;
      if (area <= bestArea) {
        bestArea = area;
        best = { measureMxl, staffIndex };
      }
    }
  }
  return best;
}

export function drawOsmdMeasureHighlight(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  measureMxl: number | null | undefined,
): void {
  host.querySelectorAll('[data-omr-measure-highlight]').forEach((el) => el.remove());
  if (!measureMxl || measureMxl < 1) return;

  const graphic = (osmd as { graphic?: { MeasureList?: GraphicalMeasureLike[][] } }).graphic;
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
      if (gm.IsExtraGraphicalMeasure) continue;
      if (measureMxlFromGraphic(gm) !== measureMxl) continue;
      const bb = gm.PositionAndShape;
      const pos = bb?.AbsolutePosition;
      const size = bb?.Size;
      if (!pos || !size) continue;
      const rect = document.createElement('div');
      rect.style.cssText = [
        'position:absolute',
        `left:${pos.x * zoom}px`,
        `top:${pos.y * zoom}px`,
        `width:${size.width * zoom}px`,
        `height:${size.height * zoom}px`,
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
