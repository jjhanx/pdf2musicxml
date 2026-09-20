/**
 * OSMD 미리보기 — 시스템 한 줄의 마디 폭을 **음표(onset) 밀도**에 비례해 재배분.
 * Softmax remesh는 이미 좁은 칸 안에서만 움직이므로, 밀집 마디는 칸 자체를 넓혀야
 * 붙임줄·셈여림이 보이고 박자 간격이 유지된다. 저장 MXL 불변.
 */
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  forEachOsmdSystem,
  measureMxlFromGraphic,
} from './osmdMeasureClick';
import { allocatedMeasureWidthOsmd } from './osmdMeasureTimingWarning';
import { setOsmdPreviewAllocatedExtents } from './osmdPreviewMeasureExtents';

/** layout remesh 타깃과 동일한 최소 필드(순환 import 방지). */
export type DensityLayoutTarget = {
  measureNumber: number;
  defaultXTenths: number;
};

type Gm = Record<string, unknown>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function readAbsX(gm: unknown): number | null {
  const g = asRecord(gm);
  const pos = asRecord(g?.PositionAndShape ?? g?.positionAndShape);
  const abs = asRecord(pos?.AbsolutePosition ?? pos?.absolutePosition);
  const x = abs?.x ?? abs?.X;
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function setAbsX(gm: unknown, x: number): void {
  const g = asRecord(gm);
  const pos = asRecord(g?.PositionAndShape ?? g?.positionAndShape);
  if (!pos) return;
  const abs = asRecord(pos.AbsolutePosition ?? pos.absolutePosition);
  if (abs) {
    abs.x = x;
    abs.X = x;
  }
}

function setSizeWidth(gm: unknown, w: number): void {
  const g = asRecord(gm);
  const pos = asRecord(g?.PositionAndShape ?? g?.positionAndShape);
  if (!pos) return;
  let size = asRecord(pos.Size ?? pos.size);
  if (!size) {
    size = { width: w, Width: w };
    pos.Size = size;
    pos.size = size;
    return;
  }
  size.width = w;
  size.Width = w;
}

function beginInstructionsWidth(gm: unknown): number {
  const g = asRecord(gm);
  const raw = g?.beginInstructionsWidth ?? g?.BeginInstructionsWidth;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** GraphicalMeasure staff entry 고유 timestamp 개수(리더 onset 근사). */
export function countUniqueOnsetsInGraphicMeasure(gm: unknown): number {
  const g = asRecord(gm);
  const entries = (g?.staffEntries ?? g?.StaffEntries) as unknown[] | undefined;
  if (!entries?.length) return 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const e = asRecord(entry);
    if (!e) continue;
    const ts = e.absoluteTimestamp ?? e.AbsoluteTimestamp ?? e.relInMeasureTimestamp;
    const tr = asRecord(ts);
    const rv =
      typeof tr?.realValue === 'number'
        ? tr.realValue
        : typeof tr?.RealValue === 'number'
          ? tr.RealValue
          : typeof ts === 'number'
            ? ts
            : null;
    if (rv == null || !Number.isFinite(rv)) {
      seen.add(`i${seen.size}`);
      continue;
    }
    seen.add(rv.toFixed(5));
  }
  return seen.size;
}

/**
 * 현재 폭 합을 유지한 채 onset 밀도 비례로 재배분.
 * ideal = base + beginInstr + perOnset×count 를 목표로 두고, 합이 total을 넘으면 비례 축소.
 */
export function allocateMeasureWidthsByDensity(
  currentWidths: number[],
  onsetCounts: number[],
  beginInstrWidths: number[] = [],
  opts?: { perOnset?: number; base?: number; minShrinkRatio?: number },
): number[] {
  const n = currentWidths.length;
  if (n === 0) return [];
  const total = currentWidths.reduce((a, b) => a + Math.max(0.5, b), 0);
  if (!(total > 1)) return currentWidths.slice();
  const perOnset = opts?.perOnset ?? 3.2;
  const base = opts?.base ?? 5;
  const minShrink = opts?.minShrinkRatio ?? 0.55;
  const ideals = currentWidths.map((cw, i) => {
    const onsets = Math.max(1, onsetCounts[i] ?? 1);
    const bi = Math.max(0, beginInstrWidths[i] ?? 0);
    const ideal = bi + base + onsets * perOnset;
    // 원래보다 과도하게 줄이지 않음(희소 마디 보호)
    return Math.max(ideal, cw * minShrink);
  });
  const idealSum = ideals.reduce((a, b) => a + b, 0);
  if (!(idealSum > 0)) return currentWidths.slice();
  if (idealSum <= total + 0.01) {
    // 남는 폭은 밀도 비례로 추가
    const leftover = total - idealSum;
    const weightSum = onsetCounts.reduce((a, c) => a + Math.max(1, c), 0);
    return ideals.map((ideal, i) => {
      const w = Math.max(1, onsetCounts[i] ?? 1);
      return ideal + leftover * (w / weightSum);
    });
  }
  // 이상 합이 더 크면 전체 스케일 다운(페이지 폭 고정)
  const scale = total / idealSum;
  return ideals.map((ideal) => ideal * scale);
}

function osmdSvgScale(osmd: OpenSheetMusicDisplay): number {
  const zoom =
    typeof (osmd as { zoom?: number }).zoom === 'number' &&
    Number.isFinite((osmd as { zoom?: number }).zoom) &&
    ((osmd as { zoom?: number }).zoom as number) > 0
      ? ((osmd as { zoom?: number }).zoom as number)
      : 1;
  const rules = asRecord((osmd as { EngravingRules?: unknown }).EngravingRules);
  const u = rules?.UnitInPixels ?? rules?.unitInPixels;
  const unit = typeof u === 'number' && Number.isFinite(u) && u > 0 ? u : 10;
  return unit * zoom;
}

function applySvgTranslateXDelta(el: Element, dx: number): void {
  if (!Number.isFinite(dx) || Math.abs(dx) < 0.05) return;
  const tr = el.getAttribute('transform') ?? '';
  const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(tr);
  const ox = m ? parseFloat(m[1]!) : 0;
  const oy = m && m[2] != null ? parseFloat(m[2]!) : 0;
  const rest = tr.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
  const prefix = `translate(${ox + dx}, ${oy})`;
  el.setAttribute('transform', rest ? `${prefix} ${rest}` : prefix);
}

function svgGElement(gm: unknown): Element | null {
  const rec = asRecord(gm);
  if (!rec) return null;
  if (typeof rec.getSVGGElement === 'function') {
    try {
      const g = (rec.getSVGGElement as () => Element | null | undefined)() ?? null;
      if (g && typeof (g as Element).closest === 'function') {
        const m = (g as Element).closest('g.vf-measure');
        if (m) return m;
      }
      if (g) return g as Element;
    } catch {
      /* fall through */
    }
  }
  return null;
}

function setStaveXWidthPx(gm: unknown, xPx: number, wPx: number): void {
  const g = asRecord(gm);
  const stave = asRecord(g?.stave ?? g?.Stave ?? g?.vfStave);
  if (!stave) return;
  try {
    if (typeof stave.setX === 'function') (stave.setX as (n: number) => void)(xPx);
    else {
      stave.x = xPx;
      stave.X = xPx;
    }
    if (typeof stave.setWidth === 'function') (stave.setWidth as (n: number) => void)(wPx);
    else {
      stave.width = wPx;
      stave.Width = wPx;
    }
  } catch {
    /* ignore */
  }
}

function onsetCountForColumn(
  rows: Gm[][],
  col: number,
  targets: readonly DensityLayoutTarget[],
): number {
  let best = 0;
  for (const row of rows) {
    const gm = row[col];
    if (!gm) continue;
    const fromGm = countUniqueOnsetsInGraphicMeasure(gm);
    const mnum = measureMxlFromGraphic(gm as never);
    let fromTargets = 0;
    if (mnum != null && targets.length) {
      const xs = new Set<string>();
      for (const t of targets) {
        if (t.measureNumber !== mnum) continue;
        if (!Number.isFinite(t.defaultXTenths)) continue;
        xs.add(t.defaultXTenths.toFixed(2));
      }
      fromTargets = xs.size;
    }
    best = Math.max(best, fromGm, fromTargets);
  }
  return Math.max(1, best);
}

const reallocDoneAtZoom = new WeakMap<object, number>();

/**
 * 시스템마다 열(마디) 폭을 onset 밀도에 맞게 재배분하고 SVG·stave·AbsolutePosition을 맞춤.
 * 같은 zoom당 1회. remesh 전에 호출해야 contentRight가 넓어진 칸을 쓴다.
 */
export function reallocateOsmdSystemMeasureWidthsByDensity(
  osmd: OpenSheetMusicDisplay,
  targets: readonly DensityLayoutTarget[] = [],
): boolean {
  if (!osmd.IsReadyToRender?.()) return false;
  const zoomNow =
    typeof (osmd as { zoom?: number }).zoom === 'number' &&
    Number.isFinite((osmd as { zoom?: number }).zoom) &&
    ((osmd as { zoom?: number }).zoom as number) > 0
      ? ((osmd as { zoom?: number }).zoom as number)
      : 1;
  const prev = reallocDoneAtZoom.get(osmd);
  if (prev != null && Math.abs(prev - zoomNow) < 1e-6) return false;

  const scale = osmdSvgScale(osmd);
  let changed = false;
  const extentMap = new Map<
    number,
    { leftEdge: number; rightEdge: number; measureShiftPx: number }
  >();

  forEachOsmdSystem(osmd, (_system, rows) => {
    if (!rows.length) return;
    const colCount = Math.max(0, ...rows.map((r) => r.length));
    if (colCount < 2) return;

    const refRow = rows.find((r) => r.length === colCount) ?? rows[0]!;
    const currentWidths: number[] = [];
    const beginInstr: number[] = [];
    const onsetCounts: number[] = [];
    const absXs: number[] = [];
    for (let mi = 0; mi < colCount; mi += 1) {
      const gm = refRow[mi]!;
      const next = refRow[mi + 1];
      const absX = readAbsX(gm);
      if (absX == null) return;
      absXs.push(absX);
      currentWidths.push(allocatedMeasureWidthOsmd(gm, next));
      beginInstr.push(beginInstructionsWidth(gm));
      onsetCounts.push(onsetCountForColumn(rows as Gm[][], mi, targets));
    }
    const newWidths = allocateMeasureWidthsByDensity(currentWidths, onsetCounts, beginInstr);
    const maxDelta = Math.max(...newWidths.map((w, i) => Math.abs(w - currentWidths[i]!)));
    if (maxDelta < 0.35) return; // 변화 미미

    let x = absXs[0]!;
    for (let mi = 0; mi < colCount; mi += 1) {
      const newW = newWidths[mi]!;
      const newX = x;
      for (const row of rows) {
        const gm = row[mi];
        if (!gm) continue;
        const oldX = readAbsX(gm);
        if (oldX == null) continue;
        const dxOsmd = newX - oldX;
        const dxPx = dxOsmd * scale;
        setAbsX(gm, newX);
        setSizeWidth(gm, newW);
        const stave = asRecord(asRecord(gm)?.stave ?? asRecord(gm)?.Stave ?? asRecord(gm)?.vfStave);
        let staveX: number | null = null;
        if (stave) {
          try {
            staveX =
              typeof stave.getX === 'function'
                ? Number((stave.getX as () => number).call(stave))
                : Number(stave.x ?? stave.X);
          } catch {
            staveX = null;
          }
        }
        if (staveX != null && Number.isFinite(staveX)) {
          setStaveXWidthPx(gm, staveX + dxPx, newW * scale);
        }
        const g = svgGElement(gm);
        if (g) applySvgTranslateXDelta(g, dxPx);
        const mnum = measureMxlFromGraphic(gm as never);
        if (mnum != null) {
          extentMap.set(mnum, {
            leftEdge: newX * scale,
            rightEdge: (newX + newW) * scale,
            measureShiftPx: dxPx,
          });
        }
      }
      x += newW;
    }
    changed = true;
  });

  if (changed) {
    setOsmdPreviewAllocatedExtents(osmd, extentMap);
    reallocDoneAtZoom.set(osmd, zoomNow);
  }
  return changed;
}

/** zoom 변경·재render 시 재배분 허용. */
export function clearOsmdSystemWidthReallocFlag(osmd: object): void {
  reallocDoneAtZoom.delete(osmd);
  setOsmdPreviewAllocatedExtents(osmd, new Map());
}
