import { PointF2D, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type OsmdMeasureClickInfo = {
  measureMxl: number;
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

function osmdBoundsToHost(bounds: HostBounds, host: HTMLElement, osmd: OpenSheetMusicDisplay): HostBounds {
  const layout = getOsmdHostLayout(host, osmd);
  return {
    left: layout.offsetX + bounds.left * layout.scale,
    top: layout.offsetY + bounds.top * layout.scale,
    right: layout.offsetX + bounds.right * layout.scale,
    bottom: layout.offsetY + bounds.bottom * layout.scale,
  };
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

function forEachGraphicalMeasure(
  osmd: OpenSheetMusicDisplay,
  fn: (gm: GraphicalMeasureLike, staffIndex: number, measureIndex: number, row: GraphicalMeasureLike[]) => void,
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
          fn(gm, si, mi, row);
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
        fn(gm, si, mi, row);
      }
    }
  } else {
    for (let si = 0; si < dim0; si += 1) {
      const row = list[si] ?? [];
      for (let mi = 0; mi < dim1; mi += 1) {
        const gm = list[si]?.[mi];
        if (!gm || isExtraMeasure(gm)) continue;
        fn(gm, si, mi, row);
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

function staffIndexForMeasureGraphic(osmd: OpenSheetMusicDisplay, gm: GraphicalMeasureLike): number {
  let found = 0;
  forEachGraphicalMeasure(osmd, (g, si) => {
    if (g === gm) found = si;
  });
  return found;
}

function measureInfoFromGraphic(gm: GraphicalMeasureLike, staffIndex: number): OsmdMeasureClickInfo | null {
  if (isExtraMeasure(gm)) return null;
  const measureMxl = measureMxlFromGraphic(gm);
  if (!measureMxl) return null;
  return { measureMxl, staffIndex };
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

function hostWidth(host: HTMLElement): number {
  const svg = host.querySelector('svg');
  return Math.max(
    host.clientWidth,
    host.getBoundingClientRect().width,
    svg?.getBoundingClientRect().width ?? 0,
    320,
  );
}

function buildStaffBandsInHost(
  system: Record<string, unknown>,
  rows: GraphicalMeasureLike[][],
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): (HostBounds | null)[] {
  const layout = getOsmdHostLayout(host, osmd);
  const w = hostWidth(host);
  const numRows = rows.length;
  const bands: (HostBounds | null)[] = new Array(numRows).fill(null);
  const known: { index: number; top: number; bottom: number }[] = [];

  const staffLines = (system.StaffLines ?? system.staffLines) as unknown[] | undefined;
  for (let i = 0; i < (staffLines?.length ?? 0); i += 1) {
    const v = graphicVerticalBoundsOsmd(staffLines?.[i]);
    if (!v) continue;
    const top = layout.offsetY + v.top * layout.scale;
    const bottom = layout.offsetY + v.bottom * layout.scale;
    if (bottom - top < 3) continue;
    bands[i] = { left: 0, top, right: w, bottom };
    known.push({ index: i, top, bottom });
  }

  for (let si = 0; si < numRows; si += 1) {
    if (bands[si]) continue;
    for (const gm of rows[si] ?? []) {
      if (!gm || isExtraMeasure(gm)) continue;
      const v = graphicVerticalBoundsOsmd(gm);
      if (!v) continue;
      const top = layout.offsetY + v.top * layout.scale - 4;
      const bottom = layout.offsetY + v.bottom * layout.scale + 4;
      bands[si] = { left: 0, top, right: w, bottom };
      known.push({ index: si, top, bottom });
      break;
    }
  }

  if (!known.length) {
    const sysV = graphicVerticalBoundsOsmd(system);
    if (sysV) {
      const top0 = layout.offsetY + sysV.top * layout.scale;
      const h = ((sysV.bottom - sysV.top) * layout.scale) / Math.max(1, numRows);
      for (let si = 0; si < numRows; si += 1) {
        bands[si] = { left: 0, top: top0 + si * h, right: w, bottom: top0 + (si + 1) * h };
      }
      return bands;
    }
    return bands;
  }

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

function buildMeasureColumnsInHost(
  rows: GraphicalMeasureLike[][],
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): ({ left: number; right: number } | null)[] {
  const layout = getOsmdHostLayout(host, osmd);
  const maxLen = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const cols: ({ left: number; right: number } | null)[] = new Array(maxLen).fill(null);
  let fallbackW = 28;
  for (const row of rows) {
    fallbackW = medianMeasureWidthOsmd(row);
    break;
  }
  for (let mi = 0; mi < maxLen; mi += 1) {
    for (const row of rows) {
      const gm = row[mi];
      if (!gm || isExtraMeasure(gm)) continue;
      const gH = graphicHorizontalOsmd(gm, row[mi + 1], fallbackW);
      if (!gH) continue;
      const left = layout.offsetX + gH.left * layout.scale;
      const right = layout.offsetX + gH.right * layout.scale;
      if (right - left >= 3) {
        cols[mi] = { left, right };
        break;
      }
    }
  }
  return cols;
}

function mergeBoundsVertical(staffBand: HostBounds | null, inner: HostBounds): HostBounds {
  if (!staffBand) return inner;
  return {
    left: inner.left,
    right: inner.right,
    top: staffBand.top,
    bottom: staffBand.bottom,
  };
}

function cellBoundsInHost(
  staffBand: HostBounds | null,
  col: { left: number; right: number } | null,
  gm: GraphicalMeasureLike,
  nextGm: GraphicalMeasureLike | undefined,
  row: GraphicalMeasureLike[],
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): HostBounds | null {
  const dom = domBoundsForMeasure(gm, host);
  if (dom && staffBand) {
    return mergeBoundsVertical(staffBand, dom);
  }
  if (dom && col) {
    return { left: col.left, top: dom.top, right: col.right, bottom: dom.bottom };
  }
  if (dom) return dom;

  const layout = getOsmdHostLayout(host, osmd);
  const fallbackW = medianMeasureWidthOsmd(row);
  let left: number;
  let right: number;
  if (col) {
    left = col.left;
    right = col.right;
  } else {
    const gH = graphicHorizontalOsmd(gm, nextGm, fallbackW);
    if (!gH) return null;
    left = layout.offsetX + gH.left * layout.scale;
    right = layout.offsetX + gH.right * layout.scale;
  }

  if (staffBand) {
    return { left, top: staffBand.top, right, bottom: staffBand.bottom };
  }

  const g = graphicOsmdBounds(gm);
  if (g) {
    const hb = osmdBoundsToHost(g, host, osmd);
    return { left, top: hb.top, right, bottom: hb.bottom };
  }
  return null;
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

  const staffBands = buildStaffBandsInHost(system, rows, host, osmd);
  const columns = buildMeasureColumnsInHost(rows, host, osmd);

  for (let si = 0; si < rows.length; si += 1) {
    const row = rows[si] ?? [];
    for (let mi = 0; mi < row.length; mi += 1) {
      const gm = row[mi];
      if (!gm || isExtraMeasure(gm)) continue;
      const measureMxl = measureMxlFromGraphic(gm);
      if (!measureMxl) continue;
      const bounds = cellBoundsInHost(staffBands[si], columns[mi] ?? null, gm, row[mi + 1], row, host, osmd);
      if (!bounds || bounds.right - bounds.left < 3 || bounds.bottom - bounds.top < 3) continue;
      const key = `${si}|${measureMxl}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ measureMxl, staffIndex: si, bounds, gm });
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

  if (!out.length) {
    forEachGraphicalMeasure(osmd, (gm, si, mi, row) => {
      const measureMxl = measureMxlFromGraphic(gm);
      if (!measureMxl) return;
      const bounds = cellBoundsInHost(null, null, gm, row[mi + 1], row, host, osmd);
      if (!bounds) return;
      const key = `${si}|${measureMxl}|${Math.round(bounds.left)}|${Math.round(bounds.top)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ measureMxl, staffIndex: si, bounds, gm });
    });
  }

  void fromPages;
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
  return null;
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
        return measureInfoFromGraphic(pm, staffIndexForMeasureGraphic(osmd, pm));
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function boundsForMeasureInfo(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  info: OsmdMeasureClickInfo,
): HostBounds | null {
  const cached = targetCache.get(host)?.find(
    (t) => t.measureMxl === info.measureMxl && t.staffIndex === info.staffIndex,
  );
  if (cached) return cached.bounds;

  const gm = findMeasureGraphic(osmd, info.measureMxl, info.staffIndex);
  if (!gm) return null;

  const dom = domBoundsForMeasure(gm, host);
  if (dom) {
    const grid = targetCache.get(host)?.find((t) => t.staffIndex === info.staffIndex);
    if (grid) {
      return {
        left: dom.left,
        right: dom.right,
        top: grid.bounds.top,
        bottom: grid.bounds.bottom,
      };
    }
    return dom;
  }

  const g = graphicOsmdBounds(gm);
  if (g) return osmdBoundsToHost(g, host, osmd);
  return null;
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
  const bounds = boundsForMeasureInfo(osmd, host, info);
  if (!bounds) return;
  paintBounds(
    host,
    bounds,
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
  const t = pickTargetAt(host, osmd, evt);
  if (t) return { measureMxl: t.measureMxl, staffIndex: t.staffIndex };
  return hitViaNearestStaffEntry(osmd, host, evt);
}

export function invalidateMeasureTargetCache(host: HTMLElement): void {
  targetCache.delete(host);
}
