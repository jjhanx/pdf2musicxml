import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  buildStaffLineCentersForSystem,
  forEachOsmdSystem,
  getOsmdPageLayout,
  partIdFromGraphic,
  rowNoteAnchorYHost,
  systemHostVerticalRange,
} from './osmdMeasureClick';

const LAYER_ATTR = 'data-omr-part-label-layer';

type GraphicalMeasureLike = Record<string, unknown>;

type StaffCluster = { top: number; bottom: number; center: number };

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

function isHorizontalStaffMark(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 28) return false;
  if (r.height <= 1.5 && r.width >= 40) return true;
  const h = Math.max(r.height, 0.5);
  return r.width / h >= 6 && h <= 10;
}

function clusterStaffLineYs(ys: number[]): StaffCluster[] {
  const sorted = [...ys].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const y of sorted) {
    const last = groups[groups.length - 1];
    if (!last || y - last[last.length - 1] > 9) groups.push([y]);
    else last.push(y);
  }
  return groups
    .filter((g) => g.length >= 4)
    .map((g) => ({
      top: g[0],
      bottom: g[g.length - 1],
      center: (g[0] + g[g.length - 1]) / 2,
    }));
}

/** OSMD가 그린 SVG 오선(가로 line/path)을 host px로 모아 5줄 단위로 묶는다. */
function collectSvgStaffClustersOnPage(host: HTMLElement, pageIndex: number): StaffCluster[] {
  const svgs = host.querySelectorAll('svg');
  const svg = svgs[pageIndex] ?? svgs[0];
  if (!svg) return [];

  const hostRect = host.getBoundingClientRect();
  const ys: number[] = [];
  const pushY = (el: Element) => {
    if (!isHorizontalStaffMark(el)) return;
    const r = el.getBoundingClientRect();
    ys.push(r.top + r.height / 2 - hostRect.top);
  };

  svg.querySelectorAll('line').forEach(pushY);
  svg.querySelectorAll('path').forEach(pushY);
  svg.querySelectorAll('rect').forEach(pushY);

  return clusterStaffLineYs(ys);
}

function clustersInSystemRange(
  clusters: StaffCluster[],
  sysRange: { top: number; bottom: number } | null,
): StaffCluster[] {
  if (!sysRange) return clusters;
  const margin = 14;
  const scoped = clusters.filter(
    (c) => c.center >= sysRange.top - margin && c.center <= sysRange.bottom + margin,
  );
  return scoped.length ? scoped : clusters;
}

function pickClusterForRow(
  clusters: StaffCluster[],
  anchorY: number | null,
  algoY: number | null,
  used: Set<number>,
): number | null {
  const hint = anchorY ?? algoY;
  if (hint == null || !clusters.length) return algoY;

  let bestI = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < clusters.length; i += 1) {
    if (used.has(i)) continue;
    const c = clusters[i];
    let score = Math.abs(c.center - hint);
    if (anchorY != null && anchorY >= c.top - 4 && anchorY <= c.bottom + 4) {
      score -= 40;
    }
    if (score < bestScore) {
      bestScore = score;
      bestI = i;
    }
  }
  if (bestI >= 0 && bestScore < 140) {
    used.add(bestI);
    return clusters[bestI].center;
  }
  return algoY;
}

function resolveStaffLabelCentersForSystem(
  host: HTMLElement,
  system: Record<string, unknown>,
  rows: GraphicalMeasureLike[][],
  pageIndex: number,
  layout: ReturnType<typeof getOsmdPageLayout>,
): (number | null)[] {
  const algoCenters = buildStaffLineCentersForSystem(system, rows, layout);
  const pageClusters = collectSvgStaffClustersOnPage(host, pageIndex);
  const sysRange = systemHostVerticalRange(system, layout);
  const clusters = clustersInSystemRange(pageClusters, sysRange).sort((a, b) => a.center - b.center);

  if (!clusters.length) return algoCenters;

  if (clusters.length === rows.length) {
    const anchors = rows.map((row) => rowNoteAnchorYHost(row, host));
    const order = rows
      .map((_, si) => ({
        si,
        key: anchors[si] ?? algoCenters[si] ?? si * 1000,
      }))
      .sort((a, b) => a.key - b.key);
    const matched: (number | null)[] = new Array(rows.length).fill(null);
    for (let rank = 0; rank < order.length; rank += 1) {
      matched[order[rank].si] = clusters[rank].center;
    }
    return matched;
  }

  const used = new Set<number>();
  const out: (number | null)[] = [];
  for (let si = 0; si < rows.length; si += 1) {
    const anchor = rowNoteAnchorYHost(rows[si] ?? [], host);
    const picked = pickClusterForRow(clusters, anchor, algoCenters[si] ?? null, used);
    out.push(picked);
  }
  return out;
}

export function removeOsmdPartLabelOverlay(host: HTMLElement): void {
  host.querySelectorAll(`[${LAYER_ATTR}]`).forEach((el) => el.remove());
}

/**
 * OSMD 기본 part-name/abbrev는 줄바꿈(2번째 system) 이후 z-order·Y 정렬이 어긋나
 * 오선 아래에 가려질 수 있어, 모든 system·모든 줄에 HTML 라벨을 겹쳐 그린다.
 * 세로 위치는 렌더된 SVG 오선(5줄 클러스터) 중앙을 우선한다.
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
    const centers = resolveStaffLabelCentersForSystem(host, system, rows, pageIndex, layout);
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
