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
        ? 'rgba(198, 40, 40, 0.22)'
        : 'rgba(198, 40, 40, 0.14)';
    box.style.cssText = [
      'position:absolute',
      `left:${bounds.left}px`,
      `top:${bounds.top}px`,
      `width:${bounds.width}px`,
      `height:${bounds.height}px`,
      `background:${tint}`,
      'border:1px solid rgba(183, 28, 28, 0.45)',
      'border-radius:2px',
      'box-sizing:border-box',
      'pointer-events:none',
    ].join(';');
    box.title =
      issue.kind === 'overfull'
        ? `마디 ${measureNumber}: 박자 초과 (${issue.actual}/${issue.expected})`
        : `마디 ${measureNumber}: 박자 부족 (${issue.actual}/${issue.expected})`;
    layer.appendChild(box);
  });
}
