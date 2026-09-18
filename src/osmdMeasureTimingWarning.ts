import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { MeasureTimingIssue } from '../shared/musicXmlMeasureTiming';
import {
  forEachGraphicalMeasure,
  measureMxlFromGraphic,
  partIdFromGraphic,
} from './osmdMeasureClick';

const OVERLAY_CLASS = 'hitl-measure-timing-warning';

function partIdsMatch(graphicPartId: string, targetPartId: string): boolean {
  const base = targetPartId.replace(/__PR$|__PL$/, '');
  const gBase = graphicPartId.replace(/__PR$|__PL$/, '');
  return (
    graphicPartId === targetPartId ||
    graphicPartId === base ||
    graphicPartId === `${base}__PR` ||
    graphicPartId === `${base}__PL` ||
    gBase === base
  );
}

function issueForGraphic(
  partId: string | null,
  measureNumber: number | null,
  issues: readonly MeasureTimingIssue[],
): MeasureTimingIssue | null {
  if (!partId || measureNumber == null) return null;
  return (
    issues.find(
      (i) => i.measureNumber === measureNumber && partIdsMatch(partId, i.partId),
    ) ?? null
  );
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function domRectsFromStaffEntry(entry: unknown): DOMRect[] {
  const rects: DOMRect[] = [];
  const e = asRecord(entry);
  if (!e) return rects;
  const gves = (e.graphicalVoiceEntries ?? e.GraphicalVoiceEntries) as unknown[] | undefined;
  for (const gve of gves ?? []) {
    const gr = asRecord(gve);
    const notes = (gr?.notes ?? gr?.Notes ?? gr?.graphicalNotes ?? gr?.GraphicalNotes) as
      | unknown[]
      | undefined;
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

function domBoundsForGraphicMeasure(
  gm: unknown,
  host: HTMLElement,
): { left: number; top: number; width: number; height: number } | null {
  const rec = asRecord(gm);
  if (!rec) return null;
  const hostRect = host.getBoundingClientRect();
  const entries = (rec.staffEntries ?? rec.StaffEntries) as unknown[] | undefined;
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
  return {
    left: left - padX,
    top: top - padY,
    width: w + padX * 2,
    height: h + padY * 2,
  };
}

/** over/under full 마디에 붉은 톤 오버레이 — 자동 박자 보정 대신 경고만. */
export function applyMeasureTimingWarningsToOsmdHost(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  issues: readonly MeasureTimingIssue[],
): void {
  host.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((el) => el.remove());
  if (!issues.length || !osmd.IsReadyToRender()) return;

  const layer =
    (host.querySelector('.osmd-measure-timing-layer') as HTMLElement | null) ??
    (() => {
      const el = document.createElement('div');
      el.className = 'osmd-measure-timing-layer';
      el.style.cssText =
        'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2;';
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(el);
      return el;
    })();

  const seen = new Set<string>();
  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const partId = partIdFromGraphic(gmRaw as Parameters<typeof partIdFromGraphic>[0]);
    const measureNumber = measureMxlFromGraphic(gmRaw as Parameters<typeof measureMxlFromGraphic>[0]);
    const issue = issueForGraphic(partId, measureNumber, issues);
    if (!issue) return;
    const key = `${partId}|${measureNumber}|${issue.kind}`;
    if (seen.has(key)) return;
    seen.add(key);

    const bounds = domBoundsForGraphicMeasure(gmRaw, host);
    if (!bounds) return;

    const box = document.createElement('div');
    box.className = OVERLAY_CLASS;
    const tint =
      issue.kind === 'overfull'
        ? 'rgba(198, 40, 40, 0.32)'
        : 'rgba(198, 40, 40, 0.16)';
    box.style.cssText = [
      'position:absolute',
      `left:${bounds.left}px`,
      `top:${bounds.top}px`,
      `width:${bounds.width}px`,
      `height:${bounds.height}px`,
      `background:${tint}`,
      'border:1.5px solid rgba(183, 28, 28, 0.65)',
      'border-radius:2px',
      'box-sizing:border-box',
      'pointer-events:none',
    ].join(';');
    box.title =
      issue.kind === 'overfull'
        ? `마디 ${measureNumber}: 박자 초과 (${issue.actual}/${issue.expected}) — 음표는 유지, 앞·뒤 마디로 넘어가지 않게 잘림`
        : `마디 ${measureNumber}: 박자 부족 (${issue.actual}/${issue.expected})`;
    layer.appendChild(box);
  });
}

function asGmRecord(gm: unknown): Record<string, unknown> | null {
  return gm && typeof gm === 'object' ? (gm as Record<string, unknown>) : null;
}

function readAbsX(gm: unknown): number | null {
  const rec = asGmRecord(gm);
  if (!rec) return null;
  const bb = asRecord(rec.PositionAndShape ?? rec.positionAndShape);
  if (!bb) return null;
  const abs = asRecord(bb.AbsolutePosition ?? bb.absolutePosition);
  if (!abs) return null;
  const x = Number(abs.x ?? abs.X);
  return Number.isFinite(x) ? x : null;
}

function readBbSizeWidth(gm: unknown): number | null {
  const rec = asGmRecord(gm);
  if (!rec) return null;
  const bb = asRecord(rec.PositionAndShape ?? rec.positionAndShape);
  if (!bb) return null;
  const size = asRecord(bb.Size ?? bb.size);
  if (!size) return null;
  const w = Number(size.width ?? size.Width);
  return Number.isFinite(w) && w > 0.5 ? w : null;
}

function readBbSizeHeight(gm: unknown): number | null {
  const rec = asGmRecord(gm);
  if (!rec) return null;
  const bb = asRecord(rec.PositionAndShape ?? rec.positionAndShape);
  if (!bb) return null;
  const size = asRecord(bb.Size ?? bb.size);
  if (!size) return null;
  const h = Number(size.height ?? size.Height);
  return Number.isFinite(h) && h > 0.5 ? h : null;
}

/**
 * 마디에 할당된 가로 폭(OSMD 단위).
 * Size.width≤0(SkyBottomLine 실패)이어도 다음 마디 AbsolutePosition.x 간격으로 복구.
 * 앞·뒤 마디 침범 clip의 공통 기준(곡·마디 하드코딩 없음).
 */
export function allocatedMeasureWidthOsmd(
  gm: unknown,
  nextGm: unknown | undefined,
  fallbackWidth = 28,
): number {
  const absX = readAbsX(gm);
  const nextX = nextGm != null ? readAbsX(nextGm) : null;
  if (absX != null && nextX != null && nextX > absX + 0.5) {
    return nextX - absX;
  }
  const sizeW = readBbSizeWidth(gm);
  if (sizeW != null) return sizeW;
  return Math.max(0.5, fallbackWidth);
}

function svgGElement(gm: unknown): Element | null {
  const rec = asGmRecord(gm);
  if (!rec || typeof rec.getSVGGElement !== 'function') return null;
  try {
    const g = (rec.getSVGGElement as () => Element | null | undefined)() ?? null;
    if (!g || g.namespaceURI !== 'http://www.w3.org/2000/svg') return null;
    return g;
  } catch {
    return null;
  }
}

/**
 * HITL faithful 미리보기 — 마디 SVG를 할당 폭으로 clip해 overfull 그림이 앞·뒤 마디 칸을 침범하지 않게 함.
 * Size.width≤0이어도 같은 오선 다음 마디 absX로 폭을 잡음(음표 XML 유지·저장 MXL 불변).
 */
export function clipOsmdMeasuresToAllocatedWidth(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
): void {
  const svg = host.querySelector('svg');
  if (!svg || !osmd.IsReadyToRender()) return;

  svg.querySelectorAll('clipPath[data-hitl-measure-clip]').forEach((el) => el.remove());
  svg.querySelectorAll('[data-hitl-measure-clipped]').forEach((el) => {
    el.removeAttribute('clip-path');
    el.removeAttribute('data-hitl-measure-clipped');
  });

  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }

  let idx = 0;
  forEachGraphicalMeasure(osmd, (gmRaw, _si, mi, row) => {
    const g = svgGElement(gmRaw);
    if (!g) return;

    const nextGm = row[mi + 1];
    const w = allocatedMeasureWidthOsmd(gmRaw, nextGm);
    if (w <= 0.5) return;
    const h = readBbSizeHeight(gmRaw) ?? 50;
    const id = `hitl-mclip-${idx}`;
    idx += 1;
    const cp = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    cp.setAttribute('id', id);
    cp.setAttribute('data-hitl-measure-clip', '1');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    // 가로: 왼 바선(로컬 0) ~ 다음 마디 시작. 세로만 여유.
    rect.setAttribute('x', '0');
    rect.setAttribute('y', String(-Math.max(h, 40)));
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(Math.max(h, 40) * 3));
    cp.appendChild(rect);
    defs!.appendChild(cp);
    g.setAttribute('clip-path', `url(#${id})`);
    g.setAttribute('data-hitl-measure-clipped', '1');
  });
}
