import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { LinkedParallelOnsetHint } from '../shared/musicXmlTimelineCleanup';
import {
  collectPlayOrderAlignGroupsFromXml,
  type PlayOrderAlignGroup,
  type PlayOrderAlignMember,
} from '../shared/musicXmlPlayOrder';
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from './osmdMeasureClick';

const previewXmlByOsmd = new WeakMap<OpenSheetMusicDisplay, string>();

export function registerOsmdPreviewXmlForAlign(osmd: OpenSheetMusicDisplay, xml: string): void {
  previewXmlByOsmd.set(osmd, xml);
}

function resolvePreviewXml(osmd: OpenSheetMusicDisplay, explicit?: string | null): string | null {
  if (explicit?.trim()) return explicit;
  return previewXmlByOsmd.get(osmd) ?? null;
}

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

const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function coordNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const r = asRecord(v);
  if (!r) return null;
  if (typeof r.realValue === 'number' && Number.isFinite(r.realValue)) return r.realValue;
  if (typeof r.RealValue === 'number' && Number.isFinite(r.RealValue)) return r.RealValue;
  return null;
}

function pitchFromGraphicNote(gn: Record<string, unknown>): string | null {
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  const pitch = asRecord(src?.Pitch ?? src?.pitch);
  if (!pitch) return null;
  const fn = coordNum(pitch.FundamentalNote ?? pitch.fundamentalNote);
  const oct = coordNum(pitch.Octave ?? pitch.octave);
  if (fn == null || oct == null || fn < 0 || fn > 6) return null;
  const accRaw = coordNum(pitch.Accidental ?? pitch.accidental);
  const acc = accRaw === -1 ? 'b' : accRaw === 1 ? '#' : '';
  return `${STEP_NAMES[fn] ?? 'C'}${acc}${oct}`;
}

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

const MAX_PLAY_ORDER_ALIGN_SHIFT_PX = 120;

type StaveGraphic = {
  svg: SVGGraphicsElement;
  centerX: number;
};

function alignPlayOrderGroup(items: StaveGraphic[]): void {
  const bySvg = new Map<SVGGraphicsElement, StaveGraphic>();
  for (const item of items) {
    const prev = bySvg.get(item.svg);
    if (!prev || item.centerX < prev.centerX) bySvg.set(item.svg, item);
  }
  const unique = [...bySvg.values()];
  if (unique.length < 2) return;
  const anchorX = Math.min(...unique.map((u) => u.centerX));
  const maxShift = Math.max(...unique.map((u) => Math.abs(anchorX - u.centerX)));
  if (maxShift > MAX_PLAY_ORDER_ALIGN_SHIFT_PX) return;
  for (const u of unique) {
    applySvgTranslateX(u.svg, anchorX - u.centerX);
  }
}

function collectGraphicsForGroup(osmd: OpenSheetMusicDisplay, group: PlayOrderAlignGroup): StaveGraphic[] {
  const targetPitches = new Set(group.members.map((m) => m.pitch));
  const out: StaveGraphic[] = [];
  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const partId = partIdFromGraphic(gmRaw);
    if (!partId) return;
    const basePart = group.partId.replace(/__PR$|__PL$/, '');
    if (partId !== group.partId && partId !== basePart && partId !== `${basePart}__PR` && partId !== `${basePart}__PL`) {
      return;
    }
    if (measureMxlFromGraphic(gmRaw) !== group.measureNumber) return;

    for (const seRaw of ((asRecord(gmRaw)?.staffEntries ?? asRecord(gmRaw)?.StaffEntries) as unknown[]) ?? []) {
      const se = asRecord(seRaw);
      if (!se) continue;
      for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          if (!gn) continue;
          const pitch = pitchFromGraphicNote(gn);
          if (!targetPitches.has(pitch ?? '')) continue;
          const svgEl = (gn as { getSVGGElement?: () => SVGGraphicsElement | null }).getSVGGElement?.();
          const stavenote = stavenoteFromGraphicEl(svgEl);
          if (!stavenote) continue;
          const centerX = noteheadCenterXInSvgRoot(stavenote);
          if (centerX == null || !Number.isFinite(centerX)) continue;
          out.push({ svg: stavenote, centerX });
        }
      }
    }
  });
  return out;
}

function alignStaffEntryColumnFallback(se: Record<string, unknown>): void {
  const items: StaveGraphic[] = [];
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
      items.push({ svg: stavenote, centerX });
    }
  }
  alignPlayOrderGroup(items);
}

export function alignOsmdPreviewNotesByOnsetColumn(
  osmd: OpenSheetMusicDisplay,
  previewXml?: string | null,
): void {
  const xml = resolvePreviewXml(osmd, previewXml);
  const groups = xml ? collectPlayOrderAlignGroupsFromXml(xml) : [];

  for (const group of groups) {
    const items = collectGraphicsForGroup(osmd, group);
    if (items.length >= 2) alignPlayOrderGroup(items);
  }

  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const gm = asRecord(gmRaw);
    if (!gm) return;
    for (const seRaw of (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[]) {
      const se = asRecord(seRaw);
      if (!se) continue;
      alignStaffEntryColumnFallback(se);
    }
  });
}

export function osmdTimestampFromLinkedParallelHint(hint: LinkedParallelOnsetHint): number {
  const len = hint.measureLength > 0 ? hint.measureLength : Math.max(1, hint.divisions);
  return hint.onset / len;
}

export function alignLinkedParallelOnsetGraphics(
  osmd: OpenSheetMusicDisplay,
  _hints: readonly LinkedParallelOnsetHint[],
  _host?: HTMLElement | null,
): void {
  alignOsmdPreviewNotesByOnsetColumn(osmd);
}
