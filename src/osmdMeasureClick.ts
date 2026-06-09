import { PointF2D, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type OsmdMeasureClickInfo = {
  measureMxl: number;
  staffIndex: number;
};

/** host 기준 CSS 픽셀 */
type HostBounds = { left: number; top: number; right: number; bottom: number };

type MeasureHitTarget = {
  measureMxl: number;
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

function measureMxlFromGraphic(gm: GraphicalMeasureLike, listIndex?: number): number {
  const sm = readSourceMeasure(gm);
  if (sm) {
    for (const key of ['MeasureNumberXML', 'measureNumberXML', 'MeasureNumber', 'measureNumber']) {
      const v = sm[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        return Math.floor(v);
      }
    }
  }
  for (const key of ['MeasureNumber', 'measureNumber']) {
    const v = gm[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      return Math.floor(v);
    }
  }
  if (typeof listIndex === 'number' && listIndex >= 0) {
    return listIndex + 1;
  }
  return 0;
}

function readPositionAndShape(obj: unknown): Record<string, unknown> | null {
  const rec = asRecord(obj);
  if (!rec) return null;
  return asRecord(rec.PositionAndShape ?? rec.positionAndShape);
}

function osmdGraphicBounds(obj: unknown): HostBounds | null {
  const bb = readPositionAndShape(obj);
  if (!bb) return null;
  const rect = asRecord(
    bb.BoundingRectangle ??
      bb.boundingRectangle ??
      bb.BoundingMarginRectangle ??
      bb.boundingMarginRectangle,
  );
  if (rect) {
    const x = Number(rect.x);
    const y = Number(rect.y);
    const w = Number(rect.width);
    const h = Number(rect.height);
    if (Number.isFinite(x) && Number.isFinite(y) && w > 0.5 && h > 0.5) {
      return { left: x, top: y, right: x + w, bottom: y + h };
    }
  }
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

function unionBounds(a: HostBounds, b: HostBounds): HostBounds {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

function domRectsFromGraph(gm: unknown): DOMRect[] {
  const rects: DOMRect[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const o = node as Record<string, unknown>;
    if (typeof o.getSVGGElement === 'function') {
      try {
        const el = (o.getSVGGElement as () => SVGGraphicsElement | null | undefined)();
        if (el && typeof el.getBoundingClientRect === 'function') {
          const r = el.getBoundingClientRect();
          if (r.width >= 0.5 && r.height >= 0.5) rects.push(r);
        }
      } catch {
        /* ignore */
      }
    }
    const childKeys = [
      'staffEntries',
      'StaffEntries',
      'graphicalVoiceEntries',
      'GraphicalVoiceEntries',
      'notes',
      'Notes',
      'graphicalNotes',
      'GraphicalNotes',
      'parentVoiceEntry',
      'parentStaffEntry',
      'ParentVoiceEntry',
      'ParentStaffEntry',
    ];
    for (const key of childKeys) {
      const child = o[key];
      if (Array.isArray(child)) {
        child.forEach(walk);
      } else if (child) {
        walk(child);
      }
    }
  };
  walk(gm);
  return rects;
}

function domBoundsInHost(gm: unknown, host: HTMLElement): HostBounds | null {
  const hostRect = host.getBoundingClientRect();
  const rects = domRectsFromGraph(gm);
  if (!rects.length) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    left = Math.min(left, r.left - hostRect.left);
    top = Math.min(top, r.top - hostRect.top);
    right = Math.max(right, r.right - hostRect.left);
    bottom = Math.max(bottom, r.bottom - hostRect.top);
  }
  if (!Number.isFinite(left)) return null;
  return { left, top, right, bottom };
}

function measureBoundsInHost(gm: GraphicalMeasureLike, host: HTMLElement, osmd: OpenSheetMusicDisplay): HostBounds | null {
  const dom = domBoundsInHost(gm, host);
  const graphic = osmdGraphicBounds(gm);
  let graphicHost = graphic ? graphicBoundsToHost(graphic, host, osmd) : null;

  const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const eb = osmdGraphicBounds(entry);
      if (eb) {
        const hb = graphicBoundsToHost(eb, host, osmd);
        graphicHost = graphicHost ? unionBounds(graphicHost, hb) : hb;
      }
    }
  }

  if (dom && graphicHost) {
    return unionBounds(dom, graphicHost);
  }
  return dom ?? graphicHost;
}

function forEachGraphicalMeasure(
  osmd: OpenSheetMusicDisplay,
  fn: (gm: GraphicalMeasureLike, staffIndex: number, measureIndex: number) => void,
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
          fn(gm, staffIndex, measureIndex);
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
    for (let mi = 0; mi < dim0; mi += 1) {
      for (let si = 0; si < dim1; si += 1) {
        const gm = list[mi]?.[si];
        if (!gm || isExtraMeasure(gm)) continue;
        fn(gm, si, mi);
      }
    }
    return;
  }

  for (let si = 0; si < dim0; si += 1) {
    for (let mi = 0; mi < dim1; mi += 1) {
      const gm = list[si]?.[mi];
      if (!gm || isExtraMeasure(gm)) continue;
      fn(gm, si, mi);
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

  forEachGraphicalMeasure(osmd, (gm, staffIndex, measureIndex) => {
    const measureMxl = measureMxlFromGraphic(gm, measureIndex);
    if (!measureMxl) return;
    const bounds = measureBoundsInHost(gm, host, osmd);
    if (!bounds) return;
    const w = bounds.right - bounds.left;
    const h = bounds.bottom - bounds.top;
    if (w < 3 || h < 3) return;
    const key = `${measureMxl}|${staffIndex}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ measureMxl, staffIndex, bounds });
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
    if (width < 3 || height < 3) continue;

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
    if (!rec || isExtraMeasure(rec)) {
      /* continue walking */
    } else if (measureMxlFromGraphic(rec) > 0 || readSourceMeasure(rec)) {
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
  let best: OsmdMeasureClickInfo | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const t of targets) {
    if (!pointInHostBounds(clickX, clickY, t.bounds)) continue;
    const area = (t.bounds.right - t.bounds.left) * (t.bounds.bottom - t.bounds.top);
    if (area < bestArea) {
      bestArea = area;
      best = { measureMxl: t.measureMxl, staffIndex: t.staffIndex };
    }
  }
  if (best) return best;

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

  return null;
}

export function drawOsmdMeasureHighlight(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  measureMxl: number | null | undefined,
): void {
  host.querySelectorAll(`[${HIGHLIGHT_LAYER_ATTR}]`).forEach((el) => el.remove());
  if (!measureMxl || measureMxl < 1) return;

  const targets = collectMeasureHitTargets(osmd, host).filter((t) => t.measureMxl === measureMxl);
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
