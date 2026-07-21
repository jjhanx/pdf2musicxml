import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { forEachOsmdSystem } from './osmdMeasureClick';

type RecordLike = Record<string, unknown>;

function asRecord(v: unknown): RecordLike | null {
  return v && typeof v === 'object' ? (v as RecordLike) : null;
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

/** phantom OSMD g.measure-number SVG만 제거 — manifest 번호는 XML <words>로 표시 */
export function hideSpuriousMeasureNumberSvgText(root: ParentNode): void {
  removeOsmdMeasureNumberSvgNodes(root);
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
  _allowed: ReadonlyMap<number, string> | undefined,
): void {
  suppressOsmdAutoMeasureNumberGraphics(osmd);
  for (const root of previewMeasureNumberRoots(host)) {
    hideSpuriousMeasureNumberSvgText(root);
  }
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
