import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { forEachOsmdSystem, getOsmdPageLayout, measureMxlFromGraphic } from './osmdMeasureClick';

type RecordLike = Record<string, unknown>;

function asRecord(v: unknown): RecordLike | null {
  return v && typeof v === 'object' ? (v as RecordLike) : null;
}

function hideGraphicalObject(obj: unknown): void {
  const rec = asRecord(obj);
  if (!rec) return;
  rec.Visible = false;
  rec.visible = false;
  const ps = asRecord(rec.PositionAndShape ?? rec.positionAndShape);
  if (ps) {
    ps.Visible = false;
    ps.visible = false;
  }
  for (const key of ['SVGElement', 'svgElement', 'domElement', 'HTMLSVGElement']) {
    const el = rec[key];
    if (el instanceof Element) {
      (el as HTMLElement).style.visibility = 'hidden';
      el.setAttribute('visibility', 'hidden');
    }
  }
}

/** OSMD MusicSystem.measureNumberLabels */
export function suppressOsmdAutoMeasureNumberGraphics(osmd: OpenSheetMusicDisplay): void {
  forEachOsmdSystem(osmd, (system) => {
    const labels = (system.measureNumberLabels ?? system.MeasureNumberLabels) as unknown[] | undefined;
    for (const label of labels ?? []) hideGraphicalObject(label);
  });
}

const MEASURE_NUM_RE = /^\d{1,3}$/;

export function hideSpuriousMeasureNumberSvgText(
  host: HTMLElement,
  allowed: ReadonlyMap<number, string> | undefined,
): void {
  const allowedLabels = new Set(allowed?.values() ?? []);
  for (const el of host.querySelectorAll('svg text, svg tspan')) {
    const t = el.textContent?.trim() ?? '';
    if (!MEASURE_NUM_RE.test(t)) continue;
    if (allowedLabels.has(t)) continue;
    const svgEl = el as SVGElement;
    svgEl.setAttribute('visibility', 'hidden');
    svgEl.style.visibility = 'hidden';
  }
}

export function applyPrintedMeasureNumberPreviewOverlay(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  allowed: ReadonlyMap<number, string>,
): void {
  const layerAttr = 'data-omr-measure-number-overlay';
  host.querySelectorAll(`[${layerAttr}]`).forEach((n) => n.remove());
  if (!allowed.size) return;

  const layer = document.createElement('div');
  layer.setAttribute(layerAttr, '1');
  layer.style.cssText =
    'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:6;';
  if (!host.style.position) host.style.position = 'relative';
  host.appendChild(layer);

  forEachOsmdSystem(osmd, (_system, rows, pageIndex) => {
    const layout = getOsmdPageLayout(host, osmd, pageIndex);
    const placed = new Set<number>();
    for (const row of rows) {
      for (const gm of row) {
        if (!gm) continue;
        const mxl = measureMxlFromGraphic(gm);
        if (mxl == null || placed.has(mxl)) continue;
        const label = allowed.get(mxl);
        if (!label) continue;
        placed.add(mxl);
        const ps = asRecord(gm.PositionAndShape ?? gm.positionAndShape);
        const abs = asRecord(ps?.AbsolutePosition ?? ps?.absolutePosition);
        const bbox = asRecord(ps?.BoundingRectangle ?? ps?.boundingRectangle);
        const x0 = Number(abs?.x ?? abs?.X ?? bbox?.x ?? bbox?.X ?? 0);
        const y0 = Number(abs?.y ?? abs?.Y ?? bbox?.y ?? bbox?.Y ?? 0);
        const span = document.createElement('span');
        span.textContent = label;
        span.style.cssText =
          'position:absolute;font-weight:700;font-size:11px;line-height:1;color:#111;font-family:Arial,sans-serif;';
        span.style.left = `${Math.max(0, layout.offsetX + x0 * layout.scale - 4)}px`;
        span.style.top = `${Math.max(0, layout.offsetY + y0 * layout.scale - 20)}px`;
        layer.appendChild(span);
      }
    }
  });
}

export function finalizeOsmdMeasureNumberPreview(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  allowed: ReadonlyMap<number, string> | undefined,
): void {
  suppressOsmdAutoMeasureNumberGraphics(osmd);
  hideSpuriousMeasureNumberSvgText(host, allowed);
  if (allowed?.size) applyPrintedMeasureNumberPreviewOverlay(host, osmd, allowed);
}
