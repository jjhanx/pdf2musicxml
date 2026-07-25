import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { LinkedParallelOnsetHint } from '../shared/musicXmlTimelineCleanup';
import { forEachGraphicalMeasure } from './osmdMeasureClick';

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function coordNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const r = asRecord(v);
  if (!r) return null;
  if (typeof r.realValue === 'number' && Number.isFinite(r.realValue)) return r.realValue;
  if (typeof r.RealValue === 'number' && Number.isFinite(r.RealValue)) return r.RealValue;
  return null;
}

function parseAccumulatedTranslateX(el: Element | null): number {
  let x = 0;
  let cur: Element | null = el;
  while (cur) {
    const tr = cur.getAttribute?.('transform') ?? '';
    const m = /translate\(\s*([-\d.]+)/.exec(tr);
    if (m) x += parseFloat(m[1]!);
    cur = cur.parentElement;
  }
  return x;
}

/** notehead path → SVG 루트 x (줌·voice column offset 후 보정용). */
function noteheadCenterXInSvgRoot(stavenote: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of stavenote.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const localX = parseFloat(m[1]!);
    const pathEl = path as SVGGraphicsElement;
    const ctm = pathEl.getCTM?.() ?? stavenote.getCTM?.();
    if (ctm) {
      xs.push(ctm.a * localX + ctm.e);
      continue;
    }
    xs.push(parseAccumulatedTranslateX(pathEl) + localX);
  }
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stavenoteFromGraphicEl(svg: SVGGraphicsElement | null): SVGGraphicsElement | null {
  if (!svg) return null;
  if (svg.classList.contains('vf-stavenote') || svg.classList.contains('vf-staveNote')) return svg;
  return svg.closest('.vf-stavenote, .vf-staveNote') as SVGGraphicsElement | null;
}

function localHorizontalDx(el: SVGGraphicsElement, dxRoot: number): number {
  const parent = el.parentElement as SVGGraphicsElement | null;
  const scale = parent?.getCTM?.()?.a;
  if (typeof scale === 'number' && Number.isFinite(scale) && Math.abs(scale) > 1e-6) {
    return dxRoot / scale;
  }
  return dxRoot;
}

function applySvgTranslateX(svg: SVGGraphicsElement, dxRoot: number): void {
  const dx = localHorizontalDx(svg, dxRoot);
  if (Math.abs(dx) < 0.01) return;
  const tr = svg.getAttribute('transform') ?? '';
  const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(tr);
  const ox = m ? parseFloat(m[1]!) : 0;
  const oy = m ? parseFloat(m[2] ?? '0') : 0;
  const rest = tr.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
  const prefix = `translate(${ox + dx}, ${oy})`;
  svg.setAttribute('transform', rest ? `${prefix} ${rest}` : prefix);
}

type StaveAtOnset = {
  ts: number;
  svg: SVGGraphicsElement;
  centerX: number;
};

const ONSET_CLUSTER_TOL = 0.001;

function collectStaveGraphicsInMeasure(gm: Record<string, unknown>): StaveAtOnset[] {
  const out: StaveAtOnset[] = [];
  for (const seRaw of (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[]) {
    const se = asRecord(seRaw);
    if (!se) continue;
    for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
      const gve = asRecord(gveRaw);
      if (!gve) continue;
      const pve = asRecord(gve.parentVoiceEntry ?? gve.ParentVoiceEntry);
      const ts = coordNum(pve?.Timestamp ?? pve?.timestamp);
      if (ts == null || !Number.isFinite(ts)) continue;

      for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
        const gn = asRecord(gnRaw);
        if (!gn) continue;
        const svgEl = (gn as { getSVGGElement?: () => SVGGraphicsElement | null }).getSVGGElement?.();
        const stavenote = stavenoteFromGraphicEl(svgEl);
        if (!stavenote) continue;
        const centerX = noteheadCenterXInSvgRoot(stavenote);
        if (centerX == null || !Number.isFinite(centerX)) continue;
        out.push({ ts, svg: stavenote, centerX });
      }
    }
  }
  return out;
}

function clusterByOnset(items: StaveAtOnset[]): StaveAtOnset[][] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => a.ts - b.ts || a.centerX - b.centerX);
  const clusters: StaveAtOnset[][] = [];
  let current: StaveAtOnset[] = [sorted[0]!];
  let clusterTs = sorted[0]!.ts;
  for (let i = 1; i < sorted.length; i += 1) {
    const item = sorted[i]!;
    if (item.ts - clusterTs > ONSET_CLUSTER_TOL) {
      clusters.push(current);
      current = [item];
      clusterTs = item.ts;
    } else {
      current.push(item);
    }
  }
  clusters.push(current);
  return clusters;
}

function alignOnsetCluster(cluster: StaveAtOnset[]): void {
  const bySvg = new Map<SVGGraphicsElement, StaveAtOnset>();
  for (const item of cluster) {
    const prev = bySvg.get(item.svg);
    if (!prev || item.centerX < prev.centerX) bySvg.set(item.svg, item);
  }
  const unique = [...bySvg.values()];
  if (unique.length < 2) return;
  const anchorX = Math.min(...unique.map((u) => u.centerX));
  for (const u of unique) {
    const dx = anchorX - u.centerX;
    if (Math.abs(dx) < 0.01) continue;
    applySvgTranslateX(u.svg, dx);
  }
}

/**
 * 미리보기 전용 — 오선(마디)마다 **같은 onset(연주 시점)** 의 notehead를
 * voice 무관하게 **같은 x column**에 둠. VoiceSpacing·XML voice·빔·박자는 건드리지 않음.
 * render() 직후 호출.
 */
export function alignOsmdPreviewNotesByOnsetColumn(osmd: OpenSheetMusicDisplay): void {
  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const gm = asRecord(gmRaw);
    if (!gm) return;
    const items = collectStaveGraphicsInMeasure(gm);
    for (const cluster of clusterByOnset(items)) {
      alignOnsetCluster(cluster);
    }
  });
}

// --- linkParallel 힌트 기반 보조 (회귀·진단용; UI는 onset column 정렬만 사용) ---

export function osmdTimestampFromLinkedParallelHint(hint: LinkedParallelOnsetHint): number {
  const len = hint.measureLength > 0 ? hint.measureLength : Math.max(1, hint.divisions);
  return hint.onset / len;
}

/** @deprecated alignOsmdPreviewNotesByOnsetColumn 사용 */
export function alignLinkedParallelOnsetGraphics(
  osmd: OpenSheetMusicDisplay,
  _hints: readonly LinkedParallelOnsetHint[],
  _host?: HTMLElement | null,
): void {
  alignOsmdPreviewNotesByOnsetColumn(osmd);
}
