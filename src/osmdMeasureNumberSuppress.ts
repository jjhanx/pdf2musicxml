import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { forEachOsmdSystem, getOsmdPageLayout, measureMxlFromGraphic } from './osmdMeasureClick';

type RecordLike = Record<string, unknown>;

function asRecord(v: unknown): RecordLike | null {
  return v && typeof v === 'object' ? (v as RecordLike) : null;
}

function normalizeMeasureNumberLabel(text: string): string {
  return text
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .trim();
}

function isMeasureNumberLabel(text: string): boolean {
  return /^\d{1,3}$/.test(normalizeMeasureNumberLabel(text));
}

/** OSMD 1.9.x: measure labels are g.measure-number (see VexFlowMusicSheetDrawer.drawLabel). */
export function removeOsmdMeasureNumberSvgNodes(root: ParentNode): number {
  let removed = 0;
  for (const el of root.querySelectorAll('g.measure-number, .measure-number')) {
    el.remove();
    removed += 1;
  }
  return removed;
}

function removeMeasureNumberGraphicalDom(label: unknown): void {
  const rec = asRecord(label);
  if (!rec) return;
  rec.Visible = false;
  rec.visible = false;
  const graphical = asRecord(rec.GraphicalLabel ?? rec.graphicalLabel ?? rec);
  if (graphical) {
    graphical.Visible = false;
    graphical.visible = false;
    const svgNode = graphical.SVGNode ?? graphical.svgNode;
    if (svgNode instanceof Element) {
      svgNode.closest('.measure-number')?.remove() ?? svgNode.remove();
    }
  }
  const svgNode = rec.SVGNode ?? rec.svgNode;
  if (svgNode instanceof Element) {
    svgNode.closest('.measure-number')?.remove() ?? svgNode.remove();
  }
}

/** OSMD MusicSystem.measureNumberLabels — render 후 DOM/SVG 정리 */
export function suppressOsmdAutoMeasureNumberGraphics(osmd: OpenSheetMusicDisplay): void {
  forEachOsmdSystem(osmd, (system) => {
    const labels = (system.measureNumberLabels ?? system.MeasureNumberLabels) as unknown[] | undefined;
    for (const label of labels ?? []) {
      removeMeasureNumberGraphicalDom(label);
    }
  });
}

/** phantom 마디 번호 SVG 제거 — 인쇄 번호는 HTML 오ver레이만 */
export function hideSpuriousMeasureNumberSvgText(root: ParentNode): void {
  removeOsmdMeasureNumberSvgNodes(root);
  for (const svg of root.querySelectorAll('svg')) {
    for (const el of [...svg.querySelectorAll('text, tspan')]) {
      const t = normalizeMeasureNumberLabel(el.textContent ?? '');
      if (!isMeasureNumberLabel(t)) continue;
      const inMeasureNumberGroup = el.closest('g.measure-number, .measure-number');
      if (inMeasureNumberGroup) {
        inMeasureNumberGroup.remove();
      } else {
        el.remove();
      }
    }
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

export function previewMeasureNumberRoots(host: HTMLElement): HTMLElement[] {
  const roots = new Set<HTMLElement>();
  roots.add(host);
  const frame = host.closest('.omr-mxl-osmd-frame');
  if (frame instanceof HTMLElement) roots.add(frame);
  return [...roots];
}

export function finalizeOsmdMeasureNumberPreview(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  allowed: ReadonlyMap<number, string> | undefined,
): void {
  suppressOsmdAutoMeasureNumberGraphics(osmd);
  for (const root of previewMeasureNumberRoots(host)) {
    hideSpuriousMeasureNumberSvgText(root);
  }
  if (allowed?.size) applyPrintedMeasureNumberPreviewOverlay(host, osmd, allowed);
}

/** 매 render 직전 OSMD 자동 마디번호 끔 */
export function enforceOsmdPreviewMeasureNumberRules(osmd: OpenSheetMusicDisplay): void {
  const rules = osmd.EngravingRules;
  rules.RenderMeasureNumbers = false;
  rules.RenderMeasureNumbersOnlyAtSystemStart = false;
  rules.UseXMLMeasureNumbers = false;
}

/** osmd.render()마다 규칙 적용 + phantom 번호 DOM 제거 */
export function patchOsmdRenderForMeasureNumbers(
  osmd: OpenSheetMusicDisplay,
  host: HTMLElement,
  getAllowed: () => ReadonlyMap<number, string> | undefined,
): void {
  const raw = osmd as unknown as RecordLike;
  if (raw.__omrMeasureNumberPatch) return;
  raw.__omrMeasureNumberPatch = true;

  const original = osmd.render.bind(osmd);
  osmd.render = () => {
    enforceOsmdPreviewMeasureNumberRules(osmd);
    original();
    finalizeOsmdMeasureNumberPreview(host, osmd, getAllowed());
  };
}

/** @deprecated MutationObserver 제거됨 — CSS + render 패치만 사용 */
export function uninstallOsmdMeasureNumberSuppressObserver(_host: HTMLElement): void {
  /* no-op */
}
