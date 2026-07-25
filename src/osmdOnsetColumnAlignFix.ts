import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { LinkedParallelOnsetHint } from '../shared/musicXmlTimelineCleanup';
import {
  collectExplicitPlayOrderColumnsFromXml,
  collectPlayOrderAlignGroupsFromXml,
  collectPreviewNoteLayoutTargetsFromXml,
  type ExplicitPlayOrderColumn,
  type PlayOrderAlignGroup,
} from '../shared/musicXmlPlayOrder';
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from './osmdMeasureClick';

const previewXmlByOsmd = new WeakMap<OpenSheetMusicDisplay, string>();

/** 미리보기 grid — 순번1(32 tenths) ↔ 마디 끝(432 tenths). */
const LAYOUT_BASE_X = 32;
const LAYOUT_SPAN = 400;

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
  const xs: number[] = [];
  for (const path of stavenote.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const localX = parseFloat(m[1]!);
    const pathEl = path as SVGGraphicsElement;
    const ctm = pathEl.getCTM?.() ?? stavenote.getCTM?.();
    if (ctm) xs.push(ctm.a * localX + ctm.e);
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

function layoutTargetKey(partId: string, measureNumber: number, staff: number, pitch: string): string {
  return `${partId}|${measureNumber}|${staff}|${pitch}`;
}

function partIdsMatch(graphicPartId: string, targetPartId: string): boolean {
  const base = targetPartId.replace(/__PR$|__PL$/, '');
  return (
    graphicPartId === targetPartId ||
    graphicPartId === base ||
    graphicPartId === `${base}__PR` ||
    graphicPartId === `${base}__PL`
  );
}

function targetXFromDefaultTenths(originX: number, spanPx: number, defaultXTenths: number): number {
  const frac = Math.max(0, Math.min(1, (defaultXTenths - LAYOUT_BASE_X) / LAYOUT_SPAN));
  return originX + frac * spanPx;
}

function staveSpanInSvgRoot(stavenote: SVGGraphicsElement): { originX: number; spanPx: number } | null {
  const stave = stavenote.closest('.vf-stave') as SVGGraphicsElement | null;
  if (!stave?.getBBox || !stave.getCTM) return null;
  const bb = stave.getBBox();
  if (bb.width <= 0) return null;
  const ctm = stave.getCTM();
  if (!ctm) return null;
  return { originX: ctm.e + ctm.a * bb.x, spanPx: ctm.a * bb.width };
}

function graphicNoteStavenote(
  osmd: OpenSheetMusicDisplay,
  gn: Record<string, unknown>,
): SVGGraphicsElement | null {
  const rules = (osmd as unknown as { EngravingRules?: { GNote?: (n: unknown) => unknown } }).EngravingRules;
  const src = gn.sourceNote ?? gn.SourceNote;
  const candidates: unknown[] = [];
  if (rules?.GNote && src) {
    try {
      candidates.push(rules.GNote(src));
    } catch {
      /* OSMD internal note lookup can fail on partial loads */
    }
  }
  candidates.push(gn);
  for (const cand of candidates) {
    const rec = asRecord(cand);
    if (!rec) continue;
    const svgEl = (rec as { getSVGGElement?: () => SVGGraphicsElement | null }).getSVGGElement?.();
    const stavenote = stavenoteFromGraphicEl(svgEl ?? null);
    if (stavenote) return stavenote;
  }
  return null;
}

type StaveGraphic = { svg: SVGGraphicsElement; centerX: number };

type LayoutTarget = { defaultXTenths: number; playOrder: number | null };

function alignPlayOrderGroupForce(items: StaveGraphic[]): void {
  const bySvg = new Map<SVGGraphicsElement, StaveGraphic>();
  for (const item of items) {
    const prev = bySvg.get(item.svg);
    if (!prev || item.centerX < prev.centerX) bySvg.set(item.svg, item);
  }
  const unique = [...bySvg.values()];
  if (unique.length < 2) return;
  const anchorX = Math.min(...unique.map((u) => u.centerX));
  for (const u of unique) {
    applySvgTranslateX(u.svg, anchorX - u.centerX);
  }
}


function collectGraphicsByPitches(
  osmd: OpenSheetMusicDisplay,
  partId: string,
  measureNumber: number,
  pitches: ReadonlySet<string>,
): StaveGraphic[] {
  const seenSvg = new Set<SVGGraphicsElement>();
  const items: StaveGraphic[] = [];
  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const graphicPartId = partIdFromGraphic(gmRaw);
    if (!graphicPartId || !partIdsMatch(graphicPartId, partId)) return;
    if (measureMxlFromGraphic(gmRaw) !== measureNumber) return;

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
          if (!pitch || !pitches.has(pitch)) continue;
          const stavenote = graphicNoteStavenote(osmd, gn);
          if (!stavenote || seenSvg.has(stavenote)) continue;
          const centerX = noteheadCenterXInSvgRoot(stavenote);
          if (centerX == null || !Number.isFinite(centerX)) continue;
          seenSvg.add(stavenote);
          items.push({ svg: stavenote, centerX });
        }
      }
    }
  });
  return items;
}

/** 명시 연주순번 — XML default-x column으로 notehead 절대 위치 (voice·순서 무관). */
function alignExplicitPlayOrderColumnsAbsolute(
  osmd: OpenSheetMusicDisplay,
  columns: ExplicitPlayOrderColumn[],
): void {
  for (const col of columns) {
    if (col.pitches.length < 1) continue;
    const pitchSet = new Set(col.pitches);
    const graphics = collectGraphicsByPitches(osmd, col.partId, col.measureNumber, pitchSet);
    if (!graphics.length) continue;

    for (const g of graphics) {
      const span = staveSpanInSvgRoot(g.svg);
      if (!span || span.spanPx <= 0) continue;
      const wantX = targetXFromDefaultTenths(span.originX, span.spanPx, col.defaultXTenths);
      const centerX = noteheadCenterXInSvgRoot(g.svg);
      if (centerX == null || !Number.isFinite(centerX)) continue;
      applySvgTranslateX(g.svg, wantX - centerX);
    }
  }
}


function collectGraphicsForGroup(osmd: OpenSheetMusicDisplay, group: PlayOrderAlignGroup): StaveGraphic[] {
  const targetPitches = new Set(group.members.map((m) => m.pitch));
  return collectGraphicsByPitches(osmd, group.partId, group.measureNumber, targetPitches);
}

/** part·마디·staff·pitch — default-x grid (명시 순번 음은 제외). */
function alignMeasureNotesByLayoutGrid(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
  staffIndex: number,
  pitchQueues: Map<string, LayoutTarget[]>,
): void {
  const partId = partIdFromGraphic(gmRaw);
  const measureNumber = measureMxlFromGraphic(gmRaw);
  if (!partId || measureNumber == null) return;

  const staff = staffIndex + 1;
  const gm = asRecord(gmRaw);
  if (!gm) return;

  type NoteHit = { stavenote: SVGGraphicsElement; pitch: string; centerX: number };
  const hits: NoteHit[] = [];
  const seenStavenote = new Set<SVGGraphicsElement>();

  for (const seRaw of (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[]) {
    const se = asRecord(seRaw);
    if (!se) continue;
    for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
      const gve = asRecord(gveRaw);
      if (!gve) continue;
      for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
        const gn = asRecord(gnRaw);
        if (!gn) continue;
        const pitch = pitchFromGraphicNote(gn);
        if (!pitch) continue;
        const stavenote = graphicNoteStavenote(osmd, gn);
        if (!stavenote || seenStavenote.has(stavenote)) continue;
        seenStavenote.add(stavenote);
        const centerX = noteheadCenterXInSvgRoot(stavenote);
        if (centerX == null || !Number.isFinite(centerX)) continue;
        hits.push({ stavenote, pitch, centerX });
      }
    }
  }
  if (!hits.length) return;

  const span = staveSpanInSvgRoot(hits[0]!.stavenote);
  if (!span || span.spanPx <= 0) return;

  for (const hit of hits) {
    const key = layoutTargetKey(partId, measureNumber, staff, hit.pitch);
    const queue = pitchQueues.get(key);
    const target = queue?.shift();
    if (!target) continue;
    const wantX = targetXFromDefaultTenths(span.originX, span.spanPx, target.defaultXTenths);
    applySvgTranslateX(hit.stavenote, wantX - hit.centerX);
  }
}

export function alignOsmdPreviewNotesByOnsetColumn(
  osmd: OpenSheetMusicDisplay,
  previewXml?: string | null,
): void {
  const xml = resolvePreviewXml(osmd, previewXml);
  const targets = xml ? collectPreviewNoteLayoutTargetsFromXml(xml) : [];
  const explicitColumns = xml ? collectExplicitPlayOrderColumnsFromXml(xml) : [];

  const explicitPoKeys = new Set(explicitColumns.map((c) => `${c.partId}|${c.measureNumber}|po:${c.playOrder}`));

  const pitchQueues = new Map<string, LayoutTarget[]>();
  for (const t of targets) {
    if (t.playOrder != null && explicitPoKeys.has(`${t.partId}|${t.measureNumber}|po:${t.playOrder}`)) {
      continue;
    }
    const key = layoutTargetKey(t.partId, t.measureNumber, t.staff, t.pitch);
    const list = pitchQueues.get(key) ?? [];
    list.push({ defaultXTenths: t.defaultXTenths, playOrder: t.playOrder });
    pitchQueues.set(key, list);
  }

  forEachGraphicalMeasure(osmd, (gmRaw, staffIndex) => {
    alignMeasureNotesByLayoutGrid(osmd, gmRaw, staffIndex, pitchQueues);
  });

  alignExplicitPlayOrderColumnsAbsolute(osmd, explicitColumns);

  const groups = xml ? collectPlayOrderAlignGroupsFromXml(xml) : [];
  for (const group of groups) {
    const items = collectGraphicsForGroup(osmd, group);
    if (items.length >= 2) alignPlayOrderGroupForce(items);
  }
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
