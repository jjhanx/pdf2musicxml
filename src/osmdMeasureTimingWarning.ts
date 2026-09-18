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
  if (!Number.isFinite(left) || right - left < 4 || bottom - top < 4) return null;
  const padX = 4;
  const padY = 6;
  return {
    left: Math.max(0, left - padX),
    top: Math.max(0, top - padY),
    width: right - left + padX * 2,
    height: bottom - top + padY * 2,
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
 * HITL faithful 미리보기 — 마디 SVG를 할당 폭으로 clip해 overfull 그림이 앞·뒤 마디 칸을 침범하지 않게 함.
 * 음표 XML은 유지(편집 가능). 저장 MXL 불변.
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
  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const rec = asGmRecord(gmRaw);
    if (!rec || typeof rec.getSVGGElement !== 'function') return;
    let g: Element | null = null;
    try {
      g = (rec.getSVGGElement as () => Element | null | undefined)() ?? null;
    } catch {
      g = null;
    }
    if (!g || g.namespaceURI !== 'http://www.w3.org/2000/svg') return;

    const w = readBbSizeWidth(gmRaw);
    if (w == null) return;
    const h = readBbSizeHeight(gmRaw) ?? 50;
    const id = `hitl-mclip-${idx}`;
    idx += 1;
    const cp = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
    cp.setAttribute('id', id);
    cp.setAttribute('data-hitl-measure-clip', '1');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    // 오선 위·아래 여유 — 가로만 마디 폭으로 제한
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
