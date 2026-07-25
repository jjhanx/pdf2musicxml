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

/** notehead → SVG 루트 x. 브라우저는 getBoundingClientRect, jsdom은 CTM/transform fallback. */
function noteheadCenterXInSvgRoot(stavenote: SVGGraphicsElement): number | null {
  const svg = stavenote.ownerSVGElement;
  const xs: number[] = [];

  if (svg && typeof svg.getBoundingClientRect === 'function') {
    const svgRect = svg.getBoundingClientRect();
    if (svgRect.width > 0 || svgRect.height > 0) {
      for (const nh of stavenote.querySelectorAll('.vf-notehead')) {
        const r = nh.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) {
          xs.push(r.left + r.width / 2 - svgRect.left);
        }
      }
    }
  }

  if (!xs.length) {
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
  }

  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stavenoteFromGraphicEl(svg: SVGGraphicsElement | null): SVGGraphicsElement | null {
  if (!svg) return null;
  if (svg.classList.contains('vf-stavenote') || svg.classList.contains('vf-staveNote')) return svg;
  return svg.closest('.vf-stavenote, .vf-staveNote') as SVGGraphicsElement | null;
}

function applySvgTranslateX(svg: SVGGraphicsElement, dxRoot: number): void {
  if (Math.abs(dxRoot) < 0.01) return;
  const ctm = svg.getCTM?.();
  const scale = ctm && Math.abs(ctm.a) > 1e-6 ? ctm.a : 1;
  const dx = dxRoot / scale;
  const tr = svg.getAttribute('transform') ?? '';
  const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(tr);
  const ox = m ? parseFloat(m[1]!) : 0;
  const oy = m ? parseFloat(m[2] ?? '0') : 0;
  const rest = tr.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
  const prefix = `translate(${ox + dx}, ${oy})`;
  svg.setAttribute('transform', rest ? `${prefix} ${rest}` : prefix);
}

type StaveGraphic = {
  svg: SVGGraphicsElement;
  centerX: number;
};

function absoluteXFromPositionShape(posRaw: unknown): number | null {
  const pos = asRecord(posRaw);
  if (!pos) return null;
  if (typeof pos.calculateAbsolutePosition === 'function') {
    (pos.calculateAbsolutePosition as () => void)();
  }
  const abs = asRecord(pos.AbsolutePosition ?? pos.absolutePosition);
  return coordNum(abs?.x ?? abs?.X);
}

/** OSMD staffEntry column x — voice column offset 전 onset column 위치. */
function staffEntryAnchorX(se: Record<string, unknown>, gm: Record<string, unknown>): number | null {
  const seX = absoluteXFromPositionShape(se.PositionAndShape ?? se.positionAndShape);
  if (seX != null && Number.isFinite(seX)) return seX;

  const tsRaw = (() => {
    for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
      const gve = asRecord(gveRaw);
      if (!gve) continue;
      const pve = asRecord(gve.parentVoiceEntry ?? gve.ParentVoiceEntry);
      const ts = coordNum(pve?.Timestamp ?? pve?.timestamp);
      if (ts != null && Number.isFinite(ts)) return ts;
    }
    return null;
  })();
  if (tsRaw == null) return null;

  const gmX = absoluteXFromPositionShape(gm.PositionAndShape ?? gm.positionAndShape);
  const gmPos = asRecord(gm.PositionAndShape ?? gm.positionAndShape);
  const size = asRecord(gmPos?.Size ?? gmPos?.size);
  const width = coordNum(size?.width ?? size?.Width);
  if (gmX == null || width == null || width <= 0) return null;
  return gmX + tsRaw * width;
}

function collectStaveGraphicsFromStaffEntry(se: Record<string, unknown>): StaveGraphic[] {
  const out: StaveGraphic[] = [];
  for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
    const gve = asRecord(gveRaw);
    if (!gve) continue;
    for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
      const gn = asRecord(gnRaw);
      if (!gn) continue;
      const svgEl = (gn as { getSVGGElement?: () => SVGGraphicsElement | null }).getSVGGElement?.();
      const stavenote = stavenoteFromGraphicEl(svgEl);
      if (!stavenote) continue;
      const centerX = noteheadCenterXInSvgRoot(stavenote);
      if (centerX == null || !Number.isFinite(centerX)) continue;
      out.push({ svg: stavenote, centerX });
    }
  }
  return out;
}

function alignStaffEntryColumn(se: Record<string, unknown>, gm: Record<string, unknown>): void {
  const items = collectStaveGraphicsFromStaffEntry(se);
  const bySvg = new Map<SVGGraphicsElement, StaveGraphic>();
  for (const item of items) {
    const prev = bySvg.get(item.svg);
    if (!prev || item.centerX < prev.centerX) bySvg.set(item.svg, item);
  }
  const unique = [...bySvg.values()];
  if (unique.length < 2) return;

  let anchorX = staffEntryAnchorX(se, gm);
  if (anchorX == null || !Number.isFinite(anchorX)) {
    anchorX = Math.min(...unique.map((u) => u.centerX));
  }

  for (const u of unique) {
    applySvgTranslateX(u.svg, anchorX - u.centerX);
  }
}

/**
 * 미리보기 전용 — OSMD staffEntry(onset column)마다 notehead x를 타임라인 column에 맞춤.
 * XML onset slot/default-x와 독립적으로 zoom·voice column offset을 SVG translate로 보정.
 */
export function alignOsmdPreviewNotesByOnsetColumn(osmd: OpenSheetMusicDisplay): void {
  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const gm = asRecord(gmRaw);
    if (!gm) return;
    for (const seRaw of (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[]) {
      const se = asRecord(seRaw);
      if (!se) continue;
      alignStaffEntryColumn(se, gm);
    }
  });
}

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
