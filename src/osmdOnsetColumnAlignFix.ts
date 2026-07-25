import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { LinkedParallelOnsetHint } from '../shared/musicXmlTimelineCleanup';
import { forEachGraphicalMeasure } from './osmdMeasureClick';

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
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

/** voice column 간격보다 큰 이동은 좌표계 오류 신호 — staffEntry 정렬 생략. */
const MAX_ONSET_ALIGN_SHIFT_PX = 120;

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

/** 동일 staffEntry 내 notehead x 정렬 — SVG 픽셀 공간만 사용(OSMD AbsolutePosition과 혼용 금지). */
function alignStaffEntryColumn(se: Record<string, unknown>): void {
  const items = collectStaveGraphicsFromStaffEntry(se);
  const bySvg = new Map<SVGGraphicsElement, StaveGraphic>();
  for (const item of items) {
    const prev = bySvg.get(item.svg);
    if (!prev || item.centerX < prev.centerX) bySvg.set(item.svg, item);
  }
  const unique = [...bySvg.values()];
  if (unique.length < 2) return;

  const anchorX = Math.min(...unique.map((u) => u.centerX));
  const maxShift = Math.max(...unique.map((u) => Math.abs(anchorX - u.centerX)));
  if (maxShift > MAX_ONSET_ALIGN_SHIFT_PX) return;

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
      alignStaffEntryColumn(se);
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
