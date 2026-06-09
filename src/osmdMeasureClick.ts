import { type OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

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

function graphicVerticalBoundsOsmd(obj: unknown): { top: number; bottom: number } | null {
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

function hostWidth(host: HTMLElement): number {
  return Math.max(host.clientWidth, host.getBoundingClientRect().width, 320);
}

/** 시스템 내 모든 성부 줄의 Y 밴드 (StaffLines·보간) */
function buildStaffBandsInHost(
  system: Record<string, unknown>,
  numRows: number,
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): (HostBounds | null)[] {
  const layout = getOsmdHostLayout(host, osmd);
  const w = hostWidth(host);
  const staffLines = (system.StaffLines ?? system.staffLines) as unknown[] | undefined;
  const bands: (HostBounds | null)[] = new Array(numRows).fill(null);
  const known: { index: number; top: number; bottom: number }[] = [];

  for (let i = 0; i < (staffLines?.length ?? 0); i += 1) {
    const v = graphicVerticalBoundsOsmd(staffLines?.[i]);
    if (!v) continue;
    const top = layout.offsetY + v.top * layout.scale;
    const bottom = layout.offsetY + v.bottom * layout.scale;
    if (bottom - top < 4) continue;
    bands[i] = { left: 0, top, right: w, bottom };
    known.push({ index: i, top, bottom });
  }

  if (!known.length) return bands;

  const avgH = known.reduce((s, k) => s + (k.bottom - k.top), 0) / known.length;
  for (let si = 0; si < numRows; si += 1) {
    if (bands[si]) continue;
    let anchor = known[0];
    let bestDist = Math.abs(si - anchor.index);
    for (const k of known) {
      const d = Math.abs(si - k.index);
      if (d < bestDist) {
        anchor = k;
        bestDist = d;
      }
    }
    const h = anchor.bottom - anchor.top || avgH;
    const delta = si - anchor.index;
    bands[si] = {
      left: 0,
      top: anchor.top + delta * h,
      right: w,
      bottom: anchor.top + (delta + 1) * h,
    };
  }
  return bands;
}

/** 마디 열 X 범위 — 여러 성부 줄 중 그래픽 좌표가 있는 줄에서 취함 */
function buildMeasureColumnsInHost(
  rows: GraphicalMeasureLike[][],
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): ({ left: number; right: number } | null)[] {
  const layout = getOsmdHostLayout(host, osmd);
  const maxLen = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cols: ({ left: number; right: number } | null)[] = new Array(maxLen).fill(null);

  for (let mi = 0; mi < maxLen; mi += 1) {
    let fallbackW = 28;
    for (const row of rows) {
      fallbackW = medianMeasureWidthOsmd(row);
      break;
    }
    for (const row of rows) {
      const gm = row[mi];
      if (!gm || isExtraMeasure(gm)) continue;
      const gH = graphicHorizontalOsmd(gm, row[mi + 1], fallbackW);
      if (!gH) continue;
      const left = osmdXToHost(gH.left, layout);
      const right = osmdXToHost(gH.right, layout);
      if (right - left >= 4) {
        cols[mi] = { left, right };
        break;
      }
    }
  }
  return cols;
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
  const pad = Math.max(4, (right - left) * 0.12);
  return { left: left - pad, right: right + pad };
}

function verticalFromGraphicMeasure(
  gm: GraphicalMeasureLike,
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): { top: number; bottom: number } | null {
  const v = graphicVerticalBoundsOsmd(gm);
  if (!v) return null;
  const layout = getOsmdHostLayout(host, osmd);
  const pad = 6;
  return {
    top: layout.offsetY + v.top * layout.scale - pad,
    bottom: layout.offsetY + v.bottom * layout.scale + pad,
  };
}

function cellBounds(
  staffBand: HostBounds | null,
  col: { left: number; right: number } | null,
  gm: GraphicalMeasureLike,
  nextGm: GraphicalMeasureLike | undefined,
  row: GraphicalMeasureLike[],
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): HostBounds | null {
  const layout = getOsmdHostLayout(host, osmd);
  const fallbackW = medianMeasureWidthOsmd(row);

  let top: number;
  let bottom: number;
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
    if (Number.isFinite(t)) {
      const padY = Math.max(4, (b - t) * 0.25);
      top = t - padY;
      bottom = b + padY;
    } else {
      const gv = verticalFromGraphicMeasure(gm, host, osmd);
      if (!gv) return null;
      top = gv.top;
      bottom = gv.bottom;
    }
  }

  let left: number;
  let right: number;
  if (col) {
    left = col.left;
    right = col.right;
  } else {
    const domH = domHorizontalForMeasure(gm, host);
    if (domH) {
      left = domH.left;
      right = domH.right;
    } else {
      const gH = graphicHorizontalOsmd(gm, nextGm, fallbackW);
      if (!gH) return null;
      left = osmdXToHost(gH.left, layout);
      right = osmdXToHost(gH.right, layout);
    }
  }

  if (right - left < 4 || bottom - top < 4) return null;
  return { left, top, right, bottom };
}

function collectFromSystem(
  system: Record<string, unknown>,
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  out: MeasureHitTarget[],
  seen: Set<string>,
): void {
  const rows = (system.GraphicalMeasures ?? system.graphicalMeasures) as GraphicalMeasureLike[][] | undefined;
  if (!rows?.length) return;

  const staffBands = buildStaffBandsInHost(system, rows.length, host, osmd);
  const columns = buildMeasureColumnsInHost(rows, host, osmd);

  for (let si = 0; si < rows.length; si += 1) {
    const row = rows[si] ?? [];
    for (let mi = 0; mi < row.length; mi += 1) {
      const gm = row[mi];
      if (!gm || isExtraMeasure(gm)) continue;
      const measureMxl = measureMxlFromGraphic(gm);
      if (!measureMxl) continue;
      const bounds = cellBounds(staffBands[si], columns[mi] ?? null, gm, row[mi + 1], row, host, osmd);
      if (!bounds) continue;
      const key = `${si}|${measureMxl}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ measureMxl, staffIndex: si, bounds, gm });
    }
  }
}

function collectFromMeasureList(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  out: MeasureHitTarget[],
  seen: Set<string>,
): void {
  const sheet = readGraphicSheet(osmd);
  const list = (sheet?.MeasureList ?? sheet?.measureList) as GraphicalMeasureLike[][] | undefined;
  if (!list?.length) return;

  const dim0 = list.length;
  const dim1 = list[0]?.length ?? 0;
  const numStaves = (sheet?.NumberOfStaves ?? sheet?.numberOfStaves) as number | undefined;
  const measureMajor =
    (numStaves ?? 0) > 0
      ? dim1 === numStaves || (dim1 <= (numStaves ?? 0) + 1 && dim0 > dim1)
      : dim0 >= dim1;

  const layout = getOsmdHostLayout(host, osmd);
  const w = hostWidth(host);

  if (measureMajor) {
    const staffRows: GraphicalMeasureLike[][] = [];
    for (let si = 0; si < dim1; si += 1) {
      staffRows.push(
        Array.from({ length: dim0 }, (_, i) => list[i]?.[si]).filter(
          (g): g is GraphicalMeasureLike => Boolean(g) && !isExtraMeasure(g),
        ),
      );
    }
    const columns = buildMeasureColumnsInHost(staffRows, host, osmd);
    const knownTops: { si: number; top: number; bottom: number }[] = [];
    for (let si = 0; si < dim1; si += 1) {
      for (let mi = 0; mi < dim0; mi += 1) {
        const gm = list[mi]?.[si];
        if (!gm || isExtraMeasure(gm)) continue;
        const gv = verticalFromGraphicMeasure(gm, host, osmd);
        if (gv) {
          knownTops.push({ si, top: gv.top, bottom: gv.bottom });
          break;
        }
      }
    }
    const avgH =
      knownTops.length > 0
        ? knownTops.reduce((s, k) => s + (k.bottom - k.top), 0) / knownTops.length
        : 48;
    const baseTop = knownTops.length ? Math.min(...knownTops.map((k) => k.top)) : layout.offsetY;

    for (let si = 0; si < dim1; si += 1) {
      const row = Array.from({ length: dim0 }, (_, i) => list[i]?.[si]).filter(
        (g): g is GraphicalMeasureLike => Boolean(g) && !isExtraMeasure(g),
      );
      const known = knownTops.find((k) => k.si === si);
      const staffBand: HostBounds = known
        ? { left: 0, top: known.top, right: w, bottom: known.bottom }
        : {
            left: 0,
            top: baseTop + si * avgH,
            right: w,
            bottom: baseTop + (si + 1) * avgH,
          };
      for (let mi = 0; mi < dim0; mi += 1) {
        const gm = list[mi]?.[si];
        if (!gm || isExtraMeasure(gm)) continue;
        const measureMxl = measureMxlFromGraphic(gm);
        if (!measureMxl) continue;
        const bounds = cellBounds(staffBand, columns[mi] ?? null, gm, list[mi + 1]?.[si], row, host, osmd);
        if (!bounds) continue;
        const key = `${si}|${measureMxl}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ measureMxl, staffIndex: si, bounds, gm });
      }
    }
  } else {
    for (let si = 0; si < dim0; si += 1) {
      const row = list[si] ?? [];
      const columns = buildMeasureColumnsInHost([row], host, osmd);
      const gv0 = row.find((g) => g && !isExtraMeasure(g));
      const gv = gv0 ? verticalFromGraphicMeasure(gv0, host, osmd) : null;
      const staffBand: HostBounds | null = gv
        ? { left: 0, top: gv.top, right: w, bottom: gv.bottom }
        : null;
      for (let mi = 0; mi < dim1; mi += 1) {
        const gm = list[si]?.[mi];
        if (!gm || isExtraMeasure(gm)) continue;
        const measureMxl = measureMxlFromGraphic(gm);
        if (!measureMxl) continue;
        const bounds = cellBounds(staffBand, columns[mi] ?? null, gm, row[mi + 1], row, host, osmd);
        if (!bounds) continue;
        const key = `${si}|${measureMxl}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ measureMxl, staffIndex: si, bounds, gm });
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
  const sheet = readGraphicSheet(osmd);

  let fromPages = 0;
  if (sheet) {
    for (const page of (sheet.MusicPages ?? sheet.musicPages) as unknown[]) {
      const pageRec = asRecord(page);
      if (!pageRec) continue;
      for (const system of (pageRec.MusicSystems ?? pageRec.musicSystems) as unknown[]) {
        const sysRec = asRecord(system);
        if (!sysRec) continue;
        collectFromSystem(sysRec, host, osmd, out, seen);
        fromPages += 1;
      }
    }
  }
  if (fromPages === 0) {
    collectFromMeasureList(osmd, host, out, seen);
  }

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
    if (Math.abs(yDiff) > 0.5) return yDiff;
    const cxA = (a.bounds.left + a.bounds.right) / 2;
    const cxB = (b.bounds.left + b.bounds.right) / 2;
    const xDiff = Math.abs(pt.x - cxA) - Math.abs(pt.x - cxB);
    if (Math.abs(xDiff) > 0.5) return xDiff;
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
  const matches = targets.filter((t) => t.measureMxl === measureMxl && t.staffIndex === staffIndex);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  const hostH = host.clientHeight || host.getBoundingClientRect().height;
  const visible = matches.filter((t) => t.bounds.bottom > 0 && t.bounds.top < hostH);
  return visible[0] ?? matches[0];
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
): void {
  removeMeasureHover(host);
  if (!info || !osmd.IsReadyToRender()) return;
  const t = findTarget(osmd, host, info.measureMxl, info.staffIndex);
  if (!t) return;
  paintBounds(
    host,
    t.bounds,
    HOVER_LAYER_ATTR,
    'border:2px solid #42a5f5;background:rgba(66,165,245,0.28);border-radius:2px;box-sizing:border-box;',
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
    'border:2px solid #1565c0;background:rgba(21,101,192,0.2);border-radius:2px;box-sizing:border-box;',
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
