import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  buildStaffLineCentersForSystem,
  forEachOsmdSystem,
  getOsmdPageLayout,
  partIdFromGraphic,
} from './osmdMeasureClick';

const LAYER_ATTR = 'data-omr-part-label-layer';

type GraphicalMeasureLike = Record<string, unknown>;

function isExtraMeasure(gm: GraphicalMeasureLike | null | undefined): boolean {
  if (!gm) return true;
  return Boolean(gm.IsExtraGraphicalMeasure ?? gm.isExtraGraphicalMeasure);
}

/** MusicXML part-list → OSMD 미리보기용 짧은 라벨(S/A/T/B/PR/PL …). */
export function parsePartLabelsFromMusicXml(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml.trim()) return map;
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return map;
    doc.querySelectorAll('part-list score-part, part-list *|score-part').forEach((sp) => {
      const id = sp.getAttribute('id');
      if (!id) return;
      const abbrev =
        sp.querySelector('part-abbreviation, *|part-abbreviation')?.textContent?.trim() ?? '';
      const name = sp.querySelector('part-name, *|part-name')?.textContent?.trim() ?? '';
      map.set(id, abbrev || name || id);
    });
  } catch {
    /* ignore */
  }
  return map;
}

function resolvePreviewPartId(id: string): { partId: string; staffWithinPart?: number } {
  const trimmed = id.trim();
  if (trimmed.endsWith('__PR')) return { partId: trimmed.slice(0, -4), staffWithinPart: 1 };
  if (trimmed.endsWith('__PL')) return { partId: trimmed.slice(0, -4), staffWithinPart: 2 };
  return { partId: trimmed };
}

function displayLabelForPartId(partId: string, labels: Map<string, string>): string {
  const direct = labels.get(partId);
  if (direct) return direct;
  const { partId: baseId, staffWithinPart } = resolvePreviewPartId(partId);
  const base = labels.get(baseId);
  if (base === 'P' && staffWithinPart === 1) return 'PR';
  if (base === 'P' && staffWithinPart === 2) return 'PL';
  if (staffWithinPart === 1) return `${base ?? baseId}·1`;
  if (staffWithinPart === 2) return `${base ?? baseId}·2`;
  return partId;
}

function firstMeasureInRow(row: GraphicalMeasureLike[]): GraphicalMeasureLike | null {
  for (const gm of row) {
    if (gm && !isExtraMeasure(gm)) return gm;
  }
  return null;
}

export function removeOsmdPartLabelOverlay(host: HTMLElement): void {
  host.querySelectorAll(`[${LAYER_ATTR}]`).forEach((el) => el.remove());
}

/**
 * OSMD 기본 part-name/abbrev는 줄바꿈(2번째 system) 이후 z-order·Y 정렬이 어긋나
 * 오선 아래에 가려질 수 있어, 모든 system·모든 줄에 HTML 라벨을 겹쳐 그린다.
 */
export function installOsmdPartLabelOverlay(
  host: HTMLElement,
  osmd: OpenSheetMusicDisplay,
  xml: string,
): void {
  removeOsmdPartLabelOverlay(host);
  if (!osmd.IsReadyToRender()) return;

  const labels = parsePartLabelsFromMusicXml(xml);
  if (!labels.size) return;

  host.style.position = host.style.position || 'relative';
  const layer = document.createElement('div');
  layer.setAttribute(LAYER_ATTR, '1');
  layer.className = 'omr-osmd-part-label-layer';

  forEachOsmdSystem(osmd, (system, rows, pageIndex) => {
    const layout = getOsmdPageLayout(host, osmd, pageIndex);
    const centers = buildStaffLineCentersForSystem(system, rows, layout);
    for (let si = 0; si < rows.length; si += 1) {
      const centerY = centers[si];
      if (centerY == null) continue;
      const gm = firstMeasureInRow(rows[si] ?? []);
      if (!gm) continue;
      const partId = partIdFromGraphic(gm);
      if (!partId) continue;
      const text = displayLabelForPartId(partId, labels);
      const el = document.createElement('span');
      el.className = 'omr-osmd-part-label';
      el.textContent = text;
      el.title = partId;
      el.style.left = `${Math.max(4, layout.offsetX + 4)}px`;
      el.style.top = `${centerY}px`;
      layer.appendChild(el);
    }
  });

  if (layer.childElementCount > 0) {
    host.appendChild(layer);
  }
}
