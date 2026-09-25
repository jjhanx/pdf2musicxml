import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  collectLinkedParallelOnsetHintsFromXml,
  type LinkedParallelOnsetHint,
} from '../shared/musicXmlTimelineCleanup';
import {
  collectPreviewNoteLayoutTargetsFromXml,
  parsePlayOrderSpec,
  type PreviewNoteLayoutTarget,
} from '../shared/musicXmlPlayOrder';
import { allocatedMeasureWidthOsmd } from './osmdMeasureTimingWarning';
import {
  forEachGraphicalMeasure,
  getOsmdUnitInPixels,
  measureMxlFromGraphic,
  partIdFromGraphic,
  staffWithinPartFromPreviewPartId,
} from './osmdMeasureClick';

/** AbsolutePosition(OSMD unit) → SVG path와 같은 px. notehead 좌표는 zoom이 반영됨. */
function osmdSvgScale(osmd: OpenSheetMusicDisplay): number {
  const zoom =
    typeof (osmd as { zoom?: number }).zoom === 'number' &&
    Number.isFinite((osmd as { zoom?: number }).zoom) &&
    ((osmd as { zoom?: number }).zoom as number) > 0
      ? ((osmd as { zoom?: number }).zoom as number)
      : 1;
  return getOsmdUnitInPixels(osmd) * zoom;
}

/** XML default-x grid (shared/musicXmlPreviewOnsetLayout PREVIEW_LAYOUT_*). */
const LAYOUT_BASE_X = 32;
const LAYOUT_SPAN = 400;

const previewXmlByOsmd = new WeakMap<OpenSheetMusicDisplay, string>();
/** remesh를 완료한 zoom. 같은 zoom에서 align 2회여도 1회만; zoom 바뀌면 다시 remesh. */
const onsetRemeshDoneAtZoom = new WeakMap<OpenSheetMusicDisplay, number>();

export function registerOsmdPreviewXmlForAlign(osmd: OpenSheetMusicDisplay, xml: string): void {
  previewXmlByOsmd.set(osmd, xml);
  onsetRemeshDoneAtZoom.delete(osmd);
}

export function getOsmdPreviewXml(osmd: OpenSheetMusicDisplay): string | null {
  return previewXmlByOsmd.get(osmd) ?? null;
}

function resolvePreviewXml(osmd: OpenSheetMusicDisplay, explicit?: string | null): string | null {
  if (explicit?.trim()) return explicit;
  return previewXmlByOsmd.get(osmd) ?? null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function coordNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const r = asRecord(v);
  if (!r) return null;
  if (typeof r.realValue === 'number' && Number.isFinite(r.realValue)) return r.realValue;
  if (typeof r.RealValue === 'number' && Number.isFinite(r.RealValue)) return r.RealValue;
  return null;
}

const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** OSMD AccidentalEnum — FLAT=1, SHARP=0 (halfTone 우선, 없을 때만 사용). */
const OSMD_ACCIDENTAL_FLAT = 1;
const OSMD_ACCIDENTAL_SHARP = 0;

function pitchLabelFromHalfTone(ht: number): string {
  const midi = Math.round(ht);
  const pcNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${pcNames[pc]}${octave}`;
}

function pitchFromVfPitch(vfpitch: unknown): string | null {
  const raw = Array.isArray(vfpitch) ? vfpitch[0] : vfpitch;
  if (typeof raw !== 'string') return null;
  const m = /^([a-g])(b?)n\/(\d+)$/i.exec(raw.trim());
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const flat = m[2] === 'b' ? 'b' : '';
  return `${step}${flat}${m[3]}`;
}

const OSMD_FUNDAMENTAL_TO_STEP: Record<number, string> = {
  0: 'C',
  2: 'D',
  4: 'E',
  5: 'F',
  7: 'G',
  9: 'A',
  11: 'B',
};

function pitchFromGraphicNote(gn: Record<string, unknown>): string | null {
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  if (src) {
    const pitch = asRecord(src.Pitch ?? src.pitch);
    if (pitch && typeof (pitch as any).ToStringShort === 'function') {
      const s = (pitch as any).ToStringShort(3);
      if (typeof s === 'string' && s.trim()) return s.trim();
    }
    const fn = coordNum(pitch?.FundamentalNote ?? pitch?.fundamentalNote);
    const oct = coordNum(pitch?.Octave ?? pitch?.octave);
    if (fn != null && oct != null) {
      const step = OSMD_FUNDAMENTAL_TO_STEP[fn] ?? (fn >= 0 && fn <= 6 ? STEP_NAMES[fn] : null);
      if (step) {
        const accRaw = coordNum(pitch?.Accidental ?? pitch?.accidental);
        const acc =
          accRaw === OSMD_ACCIDENTAL_FLAT ? 'b' : accRaw === OSMD_ACCIDENTAL_SHARP ? '#' : '';
        return `${step}${acc}${oct + 3}`;
      }
    }
    const ht = coordNum(src.halfTone ?? src.HalfTone);
    if (ht != null) {
      return pitchLabelFromHalfTone(ht + 12);
    }
  }

  const fromVf = pitchFromVfPitch(gn.vfpitch ?? gn.vfPitch);
  if (fromVf) return fromVf;

  return null;
}

function voiceFromGraphicNote(gn: Record<string, unknown>): string | null {
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  const pve = asRecord(src?.ParentVoiceEntry ?? src?.parentVoiceEntry);
  const pv = asRecord(pve?.ParentVoice ?? pve?.parentVoice);
  const id = pv?.VoiceId ?? pv?.voiceId;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  if (typeof id === 'string' && id.trim()) return id.trim();
  return null;
}

function osmdTimestampFromGraphicVoiceEntry(gve: Record<string, unknown>): number | null {
  const pve = asRecord(gve.parentVoiceEntry ?? gve.ParentVoiceEntry);
  if (!pve) return null;
  const ts = pve.Timestamp ?? pve.timestamp;
  const direct = coordNum(ts);
  if (direct != null) return direct;
  return coordNum(asRecord(ts)?.realValue ?? asRecord(ts)?.RealValue);
}

/** path/line 로컬 x + 조상 translate (SVG user unit). */
function svgUserXFromElement(el: Element, localX: number): number {
  let tx = 0;
  let cur: Element | null = el;
  while (cur) {
    const tr = cur.getAttribute?.('transform') ?? '';
    const tm = /translate\(\s*([-\d.]+)/.exec(tr);
    if (tm) tx += parseFloat(tm[1]!);
    cur = cur.parentElement;
  }
  return tx + localX;
}

function noteheadXsInSvgRoot(stavenote: SVGGraphicsElement): number[] {
  const xs: number[] = [];
  for (const path of stavenote.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    xs.push(svgUserXFromElement(path, parseFloat(m[1]!)));
  }
  return xs;
}

/** 줄기 x — 리듬 column의 일반적 기준(반대편 머리와 무관). */
function stemXInSvgRoot(stavenote: SVGGraphicsElement): number | null {
  const stemRoot =
    (stavenote.querySelector('.vf-stem') as Element | null) ??
    (stavenote.querySelector('[class*="stem"]') as Element | null);
  const scope: ParentNode = stemRoot ?? stavenote;

  for (const path of scope.querySelectorAll('path')) {
    if (!stemRoot && !path.classList.contains('vf-stem')) continue;
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    return svgUserXFromElement(path, parseFloat(m[1]!));
  }
  for (const line of scope.querySelectorAll('line')) {
    const x1 = parseFloat(line.getAttribute('x1') ?? '');
    const y1 = parseFloat(line.getAttribute('y1') ?? '0');
    const y2 = parseFloat(line.getAttribute('y2') ?? '0');
    if (!Number.isFinite(x1)) continue;
    if (Math.abs(y2 - y1) < 4) continue; // 가로선 제외
    return svgUserXFromElement(line, x1);
  }
  return null;
}

/**
 * 연주순번 column 앵커 X.
 * 기본: notehead 중심(평균) — 일반 악보와 동일.
 * 예외: 머리가 줄기 **좌·우**로 갈라진 경우(2도 등)만 줄기 x
 *        (양쪽 머리 가운데)를 써서 앞·뒤 박자 간격이 한쪽으로 치우치지 않게 함.
 */
function noteheadCenterXInSvgRoot(stavenote: SVGGraphicsElement): number | null {
  const xs = noteheadXsInSvgRoot(stavenote);
  if (xs.length === 1) return xs[0]!;
  if (xs.length > 1) {
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const spread = maxX - minX;
    // 반대편 머리: 가로로 충분히 갈라지고, 그 사이에 줄기가 있음
    const OPPOSITE_SPREAD_PX = 8;
    const STEM_SIDE_MARGIN = 3;
    if (spread >= OPPOSITE_SPREAD_PX) {
      const stem = stemXInSvgRoot(stavenote);
      if (
        stem != null &&
        Number.isFinite(stem) &&
        stem >= minX - 2 &&
        stem <= maxX + 2
      ) {
        const leftOfStem = xs.some((x) => x < stem - STEM_SIDE_MARGIN);
        const rightOfStem = xs.some((x) => x > stem + STEM_SIDE_MARGIN);
        // 한쪽은 줄기에서 떨어지고, 다른 쪽은 줄기 쪽이거나 반대편
        if (leftOfStem && rightOfStem) return stem;
        // 한쪽만 명확히 반대편(다른 쪽은 줄기에 거의 붙음) — 예: xs=231.8,243.1 stem=243.8
        if (leftOfStem || rightOfStem) return stem;
      }
    }
    return avg;
  }

  const bb = stavenote.getBBox?.();
  if (bb && bb.width > 0) {
    return svgUserXFromElement(stavenote, bb.x + bb.width / 2);
  }
  return null;
}

function stavenoteFromGraphicEl(svg: SVGGraphicsElement | null): SVGGraphicsElement | null {
  if (!svg) return null;
  if (svg.classList.contains('vf-stavenote') || svg.classList.contains('vf-staveNote')) return svg;
  return svg.closest('.vf-stavenote, .vf-staveNote') as SVGGraphicsElement | null;
}

/** 상대 snap — 좌표계 혼용·과대 이동 시 notehead 소실 방지. */
const MAX_ONSET_ALIGN_SHIFT_PX = 120;

function applySvgTranslateX(
  svg: SVGGraphicsElement,
  dxRoot: number,
  maxShiftPx: number = MAX_ONSET_ALIGN_SHIFT_PX,
): void {
  if (Math.abs(dxRoot) < 0.01) return;
  // noteheadCenterXInSvgRoot와 동일하게 SVG user unit 기준 — CTM.a로 나누지 않음
  // (나누면 a≈0.5일 때 이동량이 배가되어 po5가 과하게 밀리거나 다음 pass에서 붕괴)
  const capped = Math.sign(dxRoot) * Math.min(Math.abs(dxRoot), maxShiftPx);
  if (Math.abs(capped) < 0.01) return;
  const tr = svg.getAttribute('transform') ?? '';
  const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(tr);
  const ox = m ? parseFloat(m[1]!) : 0;
  const oy = m ? parseFloat(m[2] ?? '0') : 0;
  const rest = tr.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
  const prefix = `translate(${ox + capped}, ${oy})`;
  svg.setAttribute('transform', rest ? `${prefix} ${rest}` : prefix);
}

function layoutTargetKey(
  partId: string,
  measureNumber: number,
  staff: number,
  voice: string,
  pitch: string,
): string {
  return `${partId}|${measureNumber}|${staff}|${voice}|${pitch}`;
}

type NoteHit = {
  stavenote: SVGGraphicsElement;
  /** 화음이면 구성 pitch 전부 — 첫 pitch만 남기면 [F4,Bb4]↔G화음 오매칭 */
  pitches: string[];
  pitch: string;
  voice: string;
  centerX: number;
  /** OSMD voice-entry timestamp — duplicate voice·pitch 매칭에 x보다 신뢰 */
  timestamp: number | null;
  /** 화음 notehead 수 — [F4,Bb4](2) vs [F4,Bb4,D5,F5](4) 구분 */
  heads: number;
};

function isRestGraphicNote(gn: Record<string, unknown>): boolean {
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  if (!src) return false;
  if (typeof src.isRest === 'function') {
    try {
      if ((src.isRest as () => boolean)()) return true;
    } catch {
      /* ignore */
    }
  }
  if (typeof src.IsRest === 'function') {
    try {
      if ((src.IsRest as () => boolean)()) return true;
    } catch {
      /* ignore */
    }
  }
  if (src.isRest === true || src.IsRest === true || src.isRestFlag === true || src.IsRestFlag === true) {
    return true;
  }
  const restFlag = src.rest ?? src.Rest;
  if (restFlag === true) return true;
  if (asRecord(restFlag)) return true;
  return false;
}

function restCenterXInSvgRoot(stavenote: SVGGraphicsElement): number | null {
  const restEl =
    (stavenote.querySelector('.vf-rest') as SVGGraphicsElement | null) ??
    (stavenote.querySelector('[class*="rest"]') as SVGGraphicsElement | null) ??
    stavenote;
  if (restEl) {
    try {
      const box = restEl.getBBox?.();
      if (box && Number.isFinite(box.x) && Number.isFinite(box.width) && box.width > 0) {
        return svgUserXFromElement(restEl, box.x + box.width / 2);
      }
    } catch {
      /* getBBox can throw on detached nodes / JSDOM */
    }
    for (const path of restEl.querySelectorAll('path')) {
      const d = path.getAttribute('d');
      if (!d) continue;
      const xs: number[] = [];
      for (const m of d.matchAll(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) xs.push(n);
      }
      if (xs.length > 0) {
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        return svgUserXFromElement(path, (minX + maxX) / 2);
      }
    }
  }
  return null;
}

function pitchClassesEqual(a: string, b: string): boolean {
  if (a === b) return true;
  // OSMD vfpitch often emits Bn for MusicXML B♭ (alter=-1)
  const softB = (p: string) => p.replace(/^Bb(\d+)$/i, 'B$1');
  return softB(a) === softB(b);
}

function hitHasPitch(hit: NoteHit, pitch: string): boolean {
  if (pitch === 'REST') return hit.pitch === 'REST' || hit.pitches.includes('REST');
  if (hit.pitch === pitch || hit.pitches.includes(pitch)) return true;
  return pitchClassesEqual(hit.pitch, pitch) || hit.pitches.some((p) => pitchClassesEqual(p, pitch));
}

function collectMeasureNoteHits(osmd: OpenSheetMusicDisplay, gmRaw: unknown): NoteHit[] {
  const gm = asRecord(gmRaw);
  if (!gm) return [];
  const hits: NoteHit[] = [];
  const bySvg = new Map<SVGGraphicsElement, NoteHit>();

  for (const seRaw of (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[]) {
    const se = asRecord(seRaw);
    if (!se) continue;
    for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
      const gve = asRecord(gveRaw);
      if (!gve) continue;
      const timestamp = osmdTimestampFromGraphicVoiceEntry(gve);
      for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
        const gn = asRecord(gnRaw);
        if (!gn) continue;
        const rest = isRestGraphicNote(gn);
        const pitchRaw = rest ? null : pitchFromGraphicNote(gn);
        if (!pitchRaw && !rest) continue;
        const pitch = rest ? 'REST' : pitchRaw!;
        const voice = voiceFromGraphicNote(gn) ?? '1';
        const stavenote = graphicNoteStavenote(osmd, gn);
        if (!stavenote) continue;
        const existing = bySvg.get(stavenote);
        if (existing) {
          if (!existing.pitches.includes(pitch)) existing.pitches.push(pitch);
          if (existing.heads < 1) {
            existing.heads = stavenote.querySelectorAll('.vf-notehead').length;
          }
          continue;
        }
        const centerX = rest
          ? restCenterXInSvgRoot(stavenote)
          : noteheadCenterXInSvgRoot(stavenote);
        if (centerX == null || !Number.isFinite(centerX)) continue;
        const hit: NoteHit = {
          stavenote,
          pitches: [pitch],
          pitch,
          voice,
          centerX,
          timestamp,
          heads: rest ? 0 : stavenote.querySelectorAll('.vf-notehead').length,
        };
        bySvg.set(stavenote, hit);
        hits.push(hit);
      }
    }
  }
  return hits;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items as T[]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const head = items[i]!;
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([head, ...p]);
  }
  return out;
}

function estimateWantXFromHitsAndTargets(
  hits: readonly NoteHit[],
  targets: readonly { defaultXTenths: number }[],
  defaultXTenths: number,
): number {
  const minT = Math.min(...targets.map((t) => t.defaultXTenths));
  const maxT = Math.max(...targets.map((t) => t.defaultXTenths));
  const minX = Math.min(...hits.map((h) => h.centerX));
  const maxX = Math.max(...hits.map((h) => h.centerX));
  if (maxT <= minT || maxX <= minX) return minX;
  const frac = (defaultXTenths - minT) / (maxT - minT);
  return minX + frac * (maxX - minX);
}

/**
 * 같은 voice·pitch가 여러 column(예: F4 po2 vs po4)일 때 OSMD 순회·natural x 순서가
 * layout column과 다를 수 있음(po4가 po2보다 왼쪽에 그려지는 경우 등).
 * 1) OSMD timestamp ↔ layout default-x 순으로 매칭
 * 2) 없으면 최소 SVG 이동량(bipartite)으로 매칭 — x-only 좌→우 정렬은 역매칭 유발
 */
export function pairHitsWithLayoutTargetsByBestMatch<T extends { defaultXTenths: number }>(
  hits: readonly NoteHit[],
  targets: readonly T[],
): Array<{ hit: NoteHit; target: T }> {
  const n = Math.min(hits.length, targets.length);
  if (n === 0) return [];
  if (n === 1) return [{ hit: hits[0]!, target: targets[0]! }];

  const sortedTargets = [...targets].sort((a, b) => a.defaultXTenths - b.defaultXTenths);
  const targetPick = sortedTargets.slice(0, n);
  const hitList = [...hits];

  const allTs = hitList.every((h) => h.timestamp != null && Number.isFinite(h.timestamp));
  if (allTs) {
    const sortedHits = [...hitList].sort(
      (a, b) => a.timestamp! - b.timestamp! || a.centerX - b.centerX,
    );
    return sortedHits.map((hit, i) => ({ hit, target: targetPick[i]! }));
  }

  let bestPairs: Array<{ hit: NoteHit; target: T }> = [];
  let bestCost = Infinity;
  for (const hitPerm of permutations(hitList)) {
    for (const targPerm of permutations(targetPick)) {
      let cost = 0;
      const pairs: Array<{ hit: NoteHit; target: T }> = [];
      for (let i = 0; i < n; i += 1) {
        const hit = hitPerm[i]!;
        const target = targPerm[i]!;
        pairs.push({ hit, target });
        cost += Math.abs(
          hit.centerX - estimateWantXFromHitsAndTargets(hitList, targetPick, target.defaultXTenths),
        );
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestPairs = pairs;
      }
    }
  }
  return bestPairs;
}

function targetXFromDefaultTenths(originX: number, spanPx: number, defaultXTenths: number): number {
  const frac = Math.max(0, Math.min(1, (defaultXTenths - LAYOUT_BASE_X) / LAYOUT_SPAN));
  return originX + frac * spanPx;
}

/**
 * 마디 안 notehead들의 SVG X 범위 — 오선(시스템) 전체가 아님.
 * layout tenths(마디 상대)를 시스템 폭에 매핑하면 음표가 마디 밖으로 날아가 소실됨.
 * 왼쪽 pad는 쓰지 않음(박자·조표 beginInstructions 침범 방지).
 */
function measureSpanFromHits(hits: readonly { centerX: number }[]): { originX: number; spanPx: number } | null {
  if (hits.length < 2) return null;
  const xs = hits.map((h) => h.centerX).filter((x) => Number.isFinite(x));
  if (xs.length < 2) return null;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (max - min < 8) return null;
  return { originX: min, spanPx: max - min };
}

/**
 * 조표·박자·음자리표(beginInstructions) 직후 X (px).
 * Size/stave.width는 jsdom·일부 렌더에서 ≤0이라 쓰지 않음.
 */
function resolveContentLeftPx(osmd: OpenSheetMusicDisplay, gmRaw: unknown): number | null {
  const scale = osmdSvgScale(osmd);
  const gm = asRecord(gmRaw);
  const biRaw = gm?.beginInstructionsWidth ?? gm?.BeginInstructionsWidth;
  const bi = typeof biRaw === 'number' && Number.isFinite(biRaw) ? Math.max(0, biRaw) : 0;

  const pos = asRecord(gm?.PositionAndShape ?? gm?.positionAndShape);
  const abs = asRecord(pos?.AbsolutePosition ?? pos?.absolutePosition);
  const absX =
    typeof abs?.x === 'number' && Number.isFinite(abs.x)
      ? abs.x
      : typeof abs?.X === 'number' && Number.isFinite(abs.X)
        ? abs.X
        : null;
  if (absX != null) return (absX + bi) * scale;

  const staveRaw = gm?.stave ?? gm?.Stave;
  const stave = asRecord(staveRaw);
  let sx: number | null = null;
  if (stave && typeof stave.getX === 'function') {
    try {
      const v = (stave.getX as () => number)();
      if (typeof v === 'number' && Number.isFinite(v)) sx = v;
    } catch {
      /* */
    }
  }
  if (sx == null && typeof stave?.x === 'number' && Number.isFinite(stave.x)) sx = stave.x;
  // stave x는 이미 SVG path와 같은 px(zoom 반영) — bi만 OSMD unit
  if (sx != null) return sx + bi * scale;
  return null;
}

/**
 * 같은 part에서 다음 마디 GraphicalMeasure (시스템 row에 없어도).
 * Size.width≤0·row 끝 단독 마디에서 contentRight 복구용.
 */
function findNextMeasureGraphicOnPart(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
): unknown | null {
  const mnum = measureMxlFromGraphic(gmRaw as never);
  const partId = partIdFromGraphic(gmRaw as never);
  if (mnum == null || !partId) return null;
  let found: unknown | null = null;
  forEachGraphicalMeasure(osmd, (gm) => {
    if (found) return;
    if (partIdFromGraphic(gm as never) !== partId) return;
    if (measureMxlFromGraphic(gm as never) === mnum + 1) found = gm;
  });
  return found;
}

/**
 * 마디 내용 오른쪽 끝(다음 마디 경계·stave width·Size, endInstructions 제외) px.
 * Softmax notehead max만 쓰면 마지막 음이 마디선에 붙어 remesh 후에도 여백이 없음.
 * 시스템 row에 다음 칸이 없어도(part 다음 마디 AbsolutePosition) 복구.
 */
function resolveContentRightPx(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
  nextGm?: unknown | null,
): number | null {
  const scale = osmdSvgScale(osmd);
  const gm = asRecord(gmRaw);
  const eiRaw = gm?.endInstructionsWidth ?? gm?.EndInstructionsWidth;
  const ei = typeof eiRaw === 'number' && Number.isFinite(eiRaw) ? Math.max(0, eiRaw) : 0;

  // VexFlow stave — 이미 SVG path와 같은 px(zoom 반영). AbsolutePosition과 혼용 금지.
  const stave = asRecord(gm?.stave ?? gm?.Stave ?? gm?.vfStave);
  if (stave) {
    try {
      const sx =
        typeof stave.getX === 'function'
          ? Number((stave.getX as () => number).call(stave))
          : Number(stave.x ?? stave.X);
      const sw =
        typeof stave.getWidth === 'function'
          ? Number((stave.getWidth as () => number).call(stave))
          : Number(stave.width ?? stave.Width);
      if (Number.isFinite(sx) && Number.isFinite(sw) && sw > 8) {
        return sx + sw;
      }
    } catch {
      /* fall through */
    }
  }

  const pos = asRecord(gm?.PositionAndShape ?? gm?.positionAndShape);
  const abs = asRecord(pos?.AbsolutePosition ?? pos?.absolutePosition);
  const absX =
    typeof abs?.x === 'number' && Number.isFinite(abs.x)
      ? abs.x
      : typeof abs?.X === 'number' && Number.isFinite(abs.X)
        ? abs.X
        : null;
  if (absX == null) return null;

  let next = nextGm ?? null;
  if (next == null) {
    const cand = findNextMeasureGraphicOnPart(osmd, gmRaw);
    if (cand != null) {
      const npos = asRecord(asRecord(cand)?.PositionAndShape ?? asRecord(cand)?.positionAndShape);
      const nabs = asRecord(npos?.AbsolutePosition ?? npos?.absolutePosition);
      const nextX =
        typeof nabs?.x === 'number' && Number.isFinite(nabs.x)
          ? nabs.x
          : typeof nabs?.X === 'number' && Number.isFinite(nabs.X)
            ? nabs.X
            : null;
      // 다음 시스템으로 넘어가 absX가 리셋되면 폭 계산에 쓰지 않음
      if (nextX != null && nextX > absX + 0.5) next = cand;
    }
  }
  const w = allocatedMeasureWidthOsmd(gmRaw, next ?? undefined);
  // next도 Size도 없으면 fallback 28 — Softmax max 유지가 나음(좁은 폭으로 우겨넣기 방지)
  if (next == null) {
    const size = asRecord(pos?.Size ?? pos?.size);
    const wRaw = size?.width ?? size?.Width;
    const sizeOk = typeof wRaw === 'number' && Number.isFinite(wRaw) && wRaw > 0.5;
    if (!sizeOk) return null;
  }
  if (!(w > 0.5)) return null;
  return (absX + w - ei) * scale;
}

/**
 * 조표·박자 침범 시 notehead 구간을 통째로 우측 이동(폭 유지).
 * contentRight가 있으면 오른쪽을 마디 끝−여백까지 확장(마지막 음·혼합 박자 remesh용).
 * layoutXs가 있으면 끝 여백을 **마지막 음 onset→마디 끝(layout)** 비율로 잡아
 * 같은 박자 간격만큼 뒤에 남김(4분×4에서 마지막이 마디선에 붙지 않게).
 * 반환: placement에 쓸 [leftEdge, rightEdge] (아직 layout 그리드 미반영).
 */
function noteExtentClearedOfInstructions(
  contentLeft: number | null,
  contentRight: number | null,
  minHit: number,
  maxHit: number,
  headPad: number,
  layoutXs?: readonly number[],
): { leftEdge: number; rightEdge: number } | null {
  if (!(maxHit - minHit >= 8)) return null;
  let leftEdge = minHit;
  let rightEdge = maxHit;
  if (contentLeft != null) {
    const floor = contentLeft + headPad;
    if (leftEdge < floor) {
      const shift = floor - leftEdge;
      leftEdge += shift;
      rightEdge += shift;
    }
  }
  const spanHint = Math.max(maxHit - minHit, (contentRight ?? maxHit) - (contentLeft ?? minHit));
  let trailPad = Math.max(headPad * 2.5, spanHint * 0.06, 12);
  // Softmax-only(contentRight 없음): layout 남은 박 비율로 끝 여백.
  // contentRight가 있으면 placementSpan이 마디 끝(432)까지 매핑하므로 여기선 작은 pad만.
  if (contentRight == null && layoutXs && layoutXs.length >= 1) {
    const lxMin = Math.min(...layoutXs);
    const lxMax = Math.max(...layoutXs);
    const layoutEnd = LAYOUT_BASE_X + LAYOUT_SPAN;
    const used = Math.max(1e-6, lxMax - lxMin);
    const remain = Math.max(0, layoutEnd - lxMax);
    if (remain > 1e-3) {
      const durationTrail = spanHint * (remain / (used + remain));
      trailPad = Math.max(trailPad, durationTrail);
    }
  }
  if (contentRight != null) {
    const ceil = contentRight - trailPad;
    if (ceil > leftEdge + 8) {
      rightEdge = ceil;
    }
  } else if (rightEdge - leftEdge > trailPad + 8) {
    rightEdge -= trailPad;
  }
  if (!(rightEdge - leftEdge >= 8)) return null;
  return { leftEdge, rightEdge };
}

/**
 * notehead 구간 [left,right]에 layout-x 범위를 매핑.
 * extendToMeasureEnd: 실제 쓰인 lxMax만이 아니라 **마디 layout 끝(432)** 까지 분모에 넣어
 * 마지막 음 onset이 rightEdge에 붙지 않고, 뒤쪽에 같은 박 간격(남은 layout)만큼 남김.
 * Softmax-only(좁은 notehead span)에서는 extend 금지 — 32..432 매핑이 음을 밀집시킴.
 */
export function placementSpanFromExtentAndLayouts(
  leftEdge: number,
  rightEdge: number,
  layoutXs: readonly number[],
  extendToMeasureEnd = false,
): { originX: number; spanPx: number } | null {
  if (!(rightEdge - leftEdge >= 8) || !layoutXs.length) return null;
  const lxMin = Math.min(...layoutXs);
  const lxMax = Math.max(...layoutXs);
  const layoutEnd = LAYOUT_BASE_X + LAYOUT_SPAN;
  const lxEnd = extendToMeasureEnd ? Math.max(lxMax, layoutEnd) : lxMax;
  const f0 = Math.max(0, Math.min(1, (lxMin - LAYOUT_BASE_X) / LAYOUT_SPAN));
  const f1 = Math.max(0, Math.min(1, (lxEnd - LAYOUT_BASE_X) / LAYOUT_SPAN));
  const fSpan = Math.max(1e-6, f1 - f0);
  const spanPx = (rightEdge - leftEdge) / fSpan;
  const originX = leftEdge - f0 * spanPx;
  if (!(spanPx >= 8)) return null;
  return { originX, spanPx };
}

/**
 * 조표·박자 침범만 피하고 notehead 자연 span 폭은 유지.
 * layoutXs가 있으면 그 범위↔notehead 구간 매핑, 없으면 32..432↔구간.
 * contentRightPx가 있으면 Softmax max 대신 마디 끝−여백을 오른쪽으로 쓰고,
 * layout 매핑을 마디 끝까지 확장해 마지막 음 뒤 박자 여유를 남김.
 */
function contentSpanFromGraphicMeasure(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
  hits: readonly { centerX: number }[],
  layoutXs?: readonly number[],
  contentRightPx?: number | null,
): { originX: number; spanPx: number } | null {
  const scale = osmdSvgScale(osmd);
  const headPad = Math.max(2, scale * 0.35);
  const contentLeft = resolveContentLeftPx(osmd, gmRaw);
  const xs = hits.map((h) => h.centerX).filter((x) => Number.isFinite(x));
  if (xs.length < 2) return null;
  const hasContentRight =
    contentRightPx != null && Number.isFinite(contentRightPx) && contentRightPx > 0;
  const ext = noteExtentClearedOfInstructions(
    contentLeft,
    hasContentRight ? contentRightPx! : null,
    Math.min(...xs),
    Math.max(...xs),
    headPad,
    layoutXs,
  );
  if (!ext) return measureSpanFromHits(hits);
  const lxs = layoutXs?.length ? layoutXs : [LAYOUT_BASE_X, LAYOUT_BASE_X + LAYOUT_SPAN];
  return (
    placementSpanFromExtentAndLayouts(ext.leftEdge, ext.rightEdge, lxs, hasContentRight) ??
    measureSpanFromHits(hits)
  );
}

/** OSMD 시스템 staffIndex → MusicXML part-내 staff(1=윗줄). 전곡에서 staffIndex≠XML staff. */
function buildStaffWithinPartByStaffIndex(osmd: OpenSheetMusicDisplay): Map<number, number> {
  const byPart = new Map<string, number[]>();
  forEachGraphicalMeasure(osmd, (gmRaw, staffIndex) => {
    const partId = partIdFromGraphic(gmRaw as never);
    if (!partId) return;
    const list = byPart.get(partId) ?? [];
    if (!list.includes(staffIndex)) list.push(staffIndex);
    byPart.set(partId, list);
  });
  const out = new Map<number, number>();
  for (const [partId, indices] of byPart) {
    const fromId = staffWithinPartFromPreviewPartId(partId);
    indices.sort((a, b) => a - b);
    indices.forEach((si, i) => {
      out.set(si, fromId ?? i + 1);
    });
  }
  return out;
}

/**
 * 연주순번 layout tenths(32..432) → SVG X.
 * voice1 관측 tenths(예: 32..182)로 보간·외삽하면 po5(332)가 po2 자리 근처로 접힌다.
 * 항상 전체 PREVIEW_LAYOUT span에 비례 배치.
 */
function wantXFromLayoutGrid(
  span: { originX: number; spanPx: number },
  defaultXTenths: number,
): number {
  return targetXFromDefaultTenths(span.originX, span.spanPx, defaultXTenths);
}

/** 순번 column 최소 간격(px) — 같은 박이어도 화음끼리 겹치지 않게. */
const MIN_PLAY_ORDER_COLUMN_PX = 36;
/** 4분음(박) 하나에 해당하는 최소 가로 폭 — po4(4분)→po5 간격이 8분 간격의 ~2배가 되게. */
const MIN_PX_PER_QUARTER = 52;
/** 음표·쉼표 간 최소 시각적 안전 간격(px) — 16분 쉼표 등 짧은 박자라도 다음 요소와 겹치지 않도록 보장 */
export const MIN_NOTE_REST_GAP_PX = 24;

/**
 * content box(조표·박자 뒤)를 쓰되, 박자·순번 수에 맞춰 최소 폭으로 **오른쪽** 확장.
 * layout tenths 32..432를 이 폭에 비례 배치하므로 4분(onset+2) 간격이 8분(+1)의 약 2배.
 */
function playOrderPlacementSpan(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
  hits: readonly NoteHit[],
  distinctPlayOrders: number,
): { originX: number; spanPx: number } | null {
  const base = contentSpanFromGraphicMeasure(osmd, gmRaw, hits) ?? measureSpanFromHits(hits);
  if (!base) return null;
  const cols = Math.max(1, distinctPlayOrders);
  const minByBeat = 4 * MIN_PX_PER_QUARTER;
  const minByCols = (cols - 1) * MIN_PLAY_ORDER_COLUMN_PX;
  const minSpan = Math.max(base.spanPx, minByBeat, minByCols);
  if (minSpan <= base.spanPx + 0.5) return base;
  return { originX: base.originX, spanPx: minSpan };
}

/** 명시 연주순번만 절대 이동 — 전체 layout-x 그리드(32..432)를 마디 span에 비율 배치. */
function alignStavenoteToTarget(
  stavenote: SVGGraphicsElement,
  defaultXTenths: number,
  centerX: number,
  measureSpan: { originX: number; spanPx: number } | null,
): void {
  if (!measureSpan) return;
  const wantX = wantXFromLayoutGrid(measureSpan, defaultXTenths);
  const dx = wantX - centerX;
  const cap = Math.max(MAX_ONSET_ALIGN_SHIFT_PX, measureSpan.spanPx * 2);
  applySvgTranslateX(stavenote, dx, cap);
}

type LayoutTarget = { defaultXTenths: number; playOrder: number | null; pitch: string; voice: string };

function partIdsMatch(graphicPartId: string, targetPartId: string): boolean {
  if (graphicPartId === targetPartId) return true;
  const tBase = targetPartId.replace(/__PR$|__PL$/, '');
  const gBase = graphicPartId.replace(/__PR$|__PL$/, '');
  if (gBase !== tBase) return false;
  const tSplit = targetPartId !== tBase;
  const gSplit = graphicPartId !== gBase;
  // 둘 다 __PR/__PL 이면 접미사까지 일치해야 함(PR≠PL). 한쪽만 split이면 base 공유 허용.
  if (tSplit && gSplit) return false;
  return true;
}

/** XML `<staff>` vs part-내 오선 번호(staffWithinPart). OSMD staffIndex는 시스템 전역 행. */
function targetStaffMatchesGraphic(staffWithinPart: number, targetStaff: number): boolean {
  if (targetStaff === staffWithinPart) return true;
  // 단일 오선 추출(PR/PL split) 시 XML staff가 2여도 OSMD withinPart=1
  if (staffWithinPart === 1 && targetStaff > 1) return true;
  return false;
}

/** alignOsmdPreviewNotesByOnsetColumn 실행 중에만 채움 — 시스템 staffIndex→part내 staff. */
let activeStaffWithinPartByIndex: Map<number, number> | null = null;

function staffWithinPartForIndex(partId: string | null | undefined, staffIndex: number): number {
  const fromId = staffWithinPartFromPreviewPartId(partId);
  if (fromId != null) return fromId;
  return activeStaffWithinPartByIndex?.get(staffIndex) ?? 1;
}

function clearStavenoteTranslateX(svg: SVGGraphicsElement): void {
  const tr = svg.getAttribute('transform') ?? '';
  if (!/translate\s*\(/.test(tr)) return;
  const rest = tr.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
  if (rest) svg.setAttribute('transform', rest);
  else svg.removeAttribute('transform');
}

/** 마디 안 고아 빔·이음줄·줄기·보조선 translate 제거(음표 재배치 전). */
function clearMeasureEngravingTranslates(measureG: Element): void {
  for (const el of measureG.querySelectorAll(
    ':scope > .vf-beam, :scope > .vf-stavetie, :scope > .vf-stem, :scope > .vf-ledgers, :scope > [class*="vf-beam"], :scope > [class*="vf-tie"], :scope > [class*="vf-stem"], :scope > [class*="vf-ledgers"]',
  )) {
    if (el.closest('.vf-stavenote, .vf-staveNote')) continue;
    clearStavenoteTranslateX(el as SVGGraphicsElement);
  }
}

function readElementTranslateX(el: Element): number {
  const tr = el.getAttribute('transform') ?? '';
  const m = /translate\(\s*([-\d.]+)/.exec(tr);
  return m ? parseFloat(m[1]!) : 0;
}

/** path/line에서 세로 줄기 x (로컬). */
function stemLocalX(stemEl: Element): number | null {
  for (const path of stemEl.querySelectorAll('path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (m) return parseFloat(m[1]!);
  }
  for (const line of stemEl.querySelectorAll('line')) {
    const x1 = parseFloat(line.getAttribute('x1') ?? '');
    if (Number.isFinite(x1)) return x1;
  }
  return null;
}

/** path `d`의 모든 x(짝수 좌표)에 mapX 적용 — VexFlow beam/tie 폴리곤용. */
function mapSvgPathXs(d: string, mapX: (x: number) => number): string {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens?.length) return d;
  let cmd = '';
  let expectingX = true;
  const out: string[] = [];
  for (const tok of tokens) {
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tok)) {
      cmd = tok;
      expectingX = true;
      out.push(tok);
      continue;
    }
    const n = parseFloat(tok);
    if (!Number.isFinite(n)) {
      out.push(tok);
      continue;
    }
    if (cmd === 'H' || cmd === 'h') {
      out.push(String(mapX(n)));
      continue;
    }
    if (cmd === 'V' || cmd === 'v') {
      out.push(tok);
      continue;
    }
    if (expectingX) {
      out.push(String(mapX(n)));
      expectingX = false;
    } else {
      out.push(tok);
      expectingX = true;
    }
  }
  return out.join(' ');
}

/**
 * play-order align / contain은 `.vf-stavenote`만 translate한다.
 * VexFlow/OSMD는 빔 멤버의 줄기를 형제 `.vf-stem`으로, 빔을 `.vf-beam`으로 두어
 * 음머리만 밀리면 빔·줄기가 앞쪽(원래 자리)에 남아 끊긴 것처럼 보인다.
 * 같은 마디에서 줄기·빔(·이음줄)을 음표 shift에 맞춘다.
 *
 * 줄기 path 좌표와 빔 path는 같은 마디 사용자 좌표. stavenote translate만 반영하면
 * 빔 왼쪽이 첫 줄기보다 앞으로 삐져나오는(또는 줄기와 떨어지는) 현상을 막는다.
 */
export function syncVfStemsAndBeamsAfterStavenoteAlign(root: ParentNode): void {
  const measures = root.querySelectorAll?.('.vf-measure') ?? [];
  for (const measure of measures) {
    syncVfEngravingInMeasure(measure);
  }
}

/** 요소→마디까지 translate X 합. */
function translateXUpTo(el: Element, stop: Element): number {
  let tx = 0;
  let cur: Element | null = el;
  while (cur && cur !== stop) {
    const tr = cur.getAttribute('transform') ?? '';
    const tm = /translate\(\s*([-\d.]+)/.exec(tr);
    if (tm) tx += parseFloat(tm[1]!);
    cur = cur.parentElement;
  }
  return tx;
}

type StemTip = {
  el: Element;
  /** translate 제외한 path 기준 x (빔이 그려질 때 붙던 자리) */
  naturalX: number;
  /** stavenote/stem translate 반영 후 x */
  effectiveX: number;
  dx: number;
  /** 줄기 path의 min/max y (로컬, translate 미포함) */
  y0: number;
  y1: number;
};

function stemLocalYRange(stemEl: Element): { y0: number; y1: number } | null {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const path of stemEl.querySelectorAll('path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const ys = [...d.matchAll(/[MmLl]\s*[-\d.eE+]+\s+([-\d.eE+]+)/g)].map((m) => parseFloat(m[1]!));
    for (const y of ys) {
      if (!Number.isFinite(y)) continue;
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  for (const line of stemEl.querySelectorAll('line')) {
    const a = parseFloat(line.getAttribute('y1') ?? '');
    const b = parseFloat(line.getAttribute('y2') ?? '');
    if (Number.isFinite(a)) {
      y0 = Math.min(y0, a);
      y1 = Math.max(y1, a);
    }
    if (Number.isFinite(b)) {
      y0 = Math.min(y0, b);
      y1 = Math.max(y1, b);
    }
  }
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) return null;
  return { y0, y1 };
}

/** 줄기 샤프트가 빔 y 대역을 지나는지(다른 보표·성부 줄기 제외용). */
function stemShaftCrossesBeamY(tip: StemTip, beamY: number, slop = 36): boolean {
  return tip.y0 - slop <= beamY && tip.y1 + slop >= beamY;
}

/** 인접 줄기 간격 중앙값(SVG 좌표). zoom이 줄면 Softmax 간격·꼬리 폭이 같이 줄어든다. */
function medianAdjacentStemGap(tips: StemTip[]): number | null {
  const xs = [
    ...new Set(tips.map((t) => Math.round(t.effectiveX * 10) / 10)),
  ].sort((a, b) => a - b);
  if (xs.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const g = xs[i]! - xs[i - 1]!;
    if (g >= 3 && g <= 80) gaps.push(g);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/**
 * hook vs 2차: 인접 줄기 간격의 ~65%(5–12px).
 * 고정 12px는 작은 zoom에서 점8–16 1차(폭≈간격)까지 hook로 오분류해
 * 16분 꼬리가 다음 8분 빔에 붙은 것처럼 보인다. pad/orphan 매칭 px는 그대로.
 */
function hookMaxWidthFromTips(tips: StemTip[]): number {
  const gap = medianAdjacentStemGap(tips);
  if (gap == null) return 12;
  return Math.max(5, Math.min(12, gap * 0.65));
}

/** remesh·2차 align 후에도 같은 hook→줄기 tip을 따라가도록 (SVG 재생성 시 WeakMap 자연 소멸) */
const hookAttachedStemByBeam = new WeakMap<Element, Element>();
/** 최초 Softmax 부착이 왼쪽 끝인지 — remesh 후 tip이 멀리 가도 자유단을 뒤집지 않음 */
const hookAttachLeftByBeam = new WeakMap<Element, boolean>();

/**
 * Softmax(또는 최초 natural 매칭) 빔 span — path가 remesh 좌표로 바뀐 뒤에도
 * naturalX 매칭에 써서 tip effective를 따라가도록 한다.
 */
const beamNaturalSpanByEl = new WeakMap<Element, { left: number; right: number }>();

function findOwnerStemForHook(
  tips: StemTip[],
  beamY: number,
  hookNatL: number,
  hookNatR: number,
  coverPrim?: { left: number; right: number; midY: number; center: number } | null,
): { ownerStem: StemTip; attachLeft: boolean } | null {
  const stems = tips.filter((t) => stemShaftCrossesBeamY(t, beamY));
  if (!stems.length) return null;

  // 1) Primary exact naturalX match (tolerance <= 4.0px)
  let bestL: { tip: StemTip; d: number } | null = null;
  let bestR: { tip: StemTip; d: number } | null = null;

  for (const t of stems) {
    const dL = Math.abs(t.naturalX - hookNatL);
    const dR = Math.abs(t.naturalX - hookNatR);
    if (dL <= 4.0 && (!bestL || dL < bestL.d)) bestL = { tip: t, d: dL };
    if (dR <= 4.0 && (!bestR || dR < bestR.d)) bestR = { tip: t, d: dR };
  }

  if (bestL && !bestR) return { ownerStem: bestL.tip, attachLeft: true };
  if (bestR && !bestL) return { ownerStem: bestR.tip, attachLeft: false };
  if (bestL && bestR) {
    if (bestL.d <= bestR.d) return { ownerStem: bestL.tip, attachLeft: true };
    return { ownerStem: bestR.tip, attachLeft: false };
  }

  // 2) Wider naturalX match (tolerance <= 10.0px)
  for (const t of stems) {
    const dL = Math.abs(t.naturalX - hookNatL);
    const dR = Math.abs(t.naturalX - hookNatR);
    if (dL <= 10.0 && (!bestL || dL < bestL.d)) bestL = { tip: t, d: dL };
    if (dR <= 10.0 && (!bestR || dR < bestR.d)) bestR = { tip: t, d: dR };
  }

  if (bestL && (!bestR || bestL.d <= bestR.d)) return { ownerStem: bestL.tip, attachLeft: true };
  if (bestR) return { ownerStem: bestR.tip, attachLeft: false };

  // 3) Fallback by coverPrim stems if coverPrim exists
  if (coverPrim) {
    const edge = Math.min(6, Math.max(2.0, (coverPrim.right - coverPrim.left) * 0.15));
    const primStems = stems.filter(
      (t) =>
        (t.naturalX >= coverPrim.left - edge && t.naturalX <= coverPrim.right + edge) ||
        (t.effectiveX >= coverPrim.left - edge && t.effectiveX <= coverPrim.right + edge),
    );
    if (primStems.length >= 2) {
      const tipL = primStems.reduce((a, b) => (a.naturalX <= b.naturalX ? a : b));
      const tipR = primStems.reduce((a, b) => (a.naturalX >= b.naturalX ? a : b));
      const hookMid = (hookNatL + hookNatR) / 2;
      const dMidL = Math.abs(tipL.naturalX - hookMid);
      const dMidR = Math.abs(tipR.naturalX - hookMid);
      const chosen = dMidL <= dMidR ? tipL : tipR;
      const attachLeft = Math.abs(hookNatL - chosen.naturalX) <= Math.abs(hookNatR - chosen.naturalX);
      return { ownerStem: chosen, attachLeft };
    }
  }

  return null;
}

/**
 * 16분 꼬리(hook): 폭·방향 유지한 채 **부착 끝**을 줄기 tip에 맞춘다.
 * 부착 끝 = Softmax 1차 span 기준(reshape 전). 넓은 1차: 중심에서 먼 쪽;
 * 짧은 점8–16 1차: Softmax natural 거리가 가까운 끝(자유단→점8 오인 방지).
 */
function anchorHookBeamsToStemTips(
  measure: Element,
  tips: StemTip[],
  beamClass: Map<Element, 'primary' | 'secondary' | 'hook'>,
  primarySoftmaxSpans: Map<
    Element,
    { left: number; right: number; midY: number; center: number }
  >,
): void {
  if (!tips.length) return;

  type Prim = { left: number; right: number; midY: number; center: number };
  const primaries: Prim[] = [...primarySoftmaxSpans.values()];
  if (!primaries.length) {
    for (const [el, kind] of beamClass) {
      if (kind !== 'primary') continue;
      const path = el.querySelector('path');
      const d = path?.getAttribute('d');
      if (!d) continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const m of d.matchAll(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) xs.push(n);
      }
      for (const m of d.matchAll(
        /[MmLl]\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g,
      )) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) ys.push(n);
      }
      if (xs.length < 2) continue;
      const btx = readElementTranslateX(el as SVGGraphicsElement);
      const left = Math.min(...xs) + btx;
      const right = Math.max(...xs) + btx;
      primaries.push({
        left,
        right,
        midY: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0,
        center: (left + right) / 2,
      });
    }
  }

  const gapHint = medianAdjacentStemGap(tips);

  for (const [el, kind] of beamClass) {
    if (kind !== 'hook') continue;
    if (el.closest('.vf-stavenote, .vf-staveNote')) continue;
    const beamTx = readElementTranslateX(el as SVGGraphicsElement);
    for (const path of el.querySelectorAll('path')) {
      const d = path.getAttribute('d');
      if (!d) continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const m of d.matchAll(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) xs.push(n);
      }
      for (const m of d.matchAll(
        /[MmLl]\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g,
      )) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) ys.push(n);
      }
      if (xs.length < 2) continue;
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      if (right - left < 1) continue;
      const visL = left + beamTx;
      const visR = right + beamTx;
      const midVis = (visL + visR) / 2;
      const beamY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
      const w = right - left;

      // Remember initial natural span of hook element if not already recorded
      const storedSpan = beamNaturalSpanByEl.get(el);
      const natL = storedSpan?.left ?? left;
      const natR = storedSpan?.right ?? right;
      if (!storedSpan) beamNaturalSpanByEl.set(el, { left: natL, right: natR });

      let coverPrim: Prim | null = null;
      let bestPrimScore = Infinity;
      const hookMidNat = (natL + natR) / 2;
      for (const p of primaries) {
        if (Math.abs(p.midY - beamY) > 14) continue;
        const edge = Math.min(6, Math.max(2.0, (p.right - p.left) * 0.15));
        const containsNat = hookMidNat >= p.left - edge && hookMidNat <= p.right + edge;
        const containsVis = midVis >= p.left - edge && midVis <= p.right + edge;
        if (!containsNat && !containsVis) continue;
        const ref = containsNat ? hookMidNat : midVis;
        const score = Math.abs(p.center - ref);
        if (score < bestPrimScore) {
          bestPrimScore = score;
          coverPrim = p;
        }
      }

      const matchResult = findOwnerStemForHook(tips, beamY, natL, natR, coverPrim);
      if (!matchResult) continue;

      const bestTip = matchResult.ownerStem;
      const attachLeft = matchResult.attachLeft;

      hookAttachedStemByBeam.set(el, bestTip.el);
      hookAttachLeftByBeam.set(el, attachLeft);

      // 16분·32분 꼬리(hook)의 자유단(free-end)이 인접 줄기에 가서 붙거나 겹치지 않도록 가로 폭(width) 제한
      let targetW = w;
      if (attachLeft) {
        // Forward hook: attached at bestTip.effectiveX, extending right towards adjacent stem to the right
        const otherStems = tips
          .filter((t) => t.el !== bestTip!.el && stemShaftCrossesBeamY(t, beamY) && t.effectiveX > bestTip!.effectiveX + 0.5)
          .sort((a, b) => a.effectiveX - b.effectiveX);
        if (otherStems.length) {
          const gap = otherStems[0]!.effectiveX - bestTip.effectiveX;
          const margin = Math.max(1.8, Math.min(5.0, gap * 0.4));
          const maxAllowed = Math.max(2.0, gap - margin);
          targetW = Math.min(w, maxAllowed);
        }
      } else {
        // Backward hook: attached at bestTip.effectiveX, extending left towards adjacent stem to the left
        const otherStems = tips
          .filter((t) => t.el !== bestTip!.el && stemShaftCrossesBeamY(t, beamY) && t.effectiveX < bestTip!.effectiveX - 0.5)
          .sort((a, b) => b.effectiveX - a.effectiveX);
        if (otherStems.length) {
          const gap = bestTip.effectiveX - otherStems[0]!.effectiveX;
          const margin = Math.max(1.8, Math.min(5.0, gap * 0.4));
          const maxAllowed = Math.max(2.0, gap - margin);
          targetW = Math.min(w, maxAllowed);
        }
      }

      const origW = right - left;
      const newLeft = attachLeft ? bestTip.effectiveX : bestTip.effectiveX - targetW;
      const newRight = attachLeft ? bestTip.effectiveX + targetW : bestTip.effectiveX;

      if (
        Math.abs(newLeft - visL) < 0.35 &&
        Math.abs(newRight - visR) < 0.35 &&
        Math.abs(beamTx) < 0.35
      ) {
        continue;
      }

      const mapX = (x: number) => {
        const t = origW > 0 ? (x - left) / origW : 0;
        return newLeft + t * (newRight - newLeft);
      };

      path.setAttribute('d', mapSvgPathXs(d, mapX));
      if (Math.abs(beamTx) >= 0.01) clearStavenoteTranslateX(el as SVGGraphicsElement);
    }
  }
}

function collectStemTipsInMeasure(measure: Element): StemTip[] {
  const tips: StemTip[] = [];
  const seen = new Set<Element>();
  const stemNodes = [
    ...measure.querySelectorAll(':scope > .vf-stem, :scope > [class*="vf-stem"]'),
    ...measure.querySelectorAll('.vf-stavenote .vf-stem, .vf-staveNote .vf-stem'),
  ];
  for (const stem of stemNodes) {
    if (seen.has(stem)) continue;
    seen.add(stem);
    const localX = stemLocalX(stem);
    if (localX == null) continue;
    const yr = stemLocalYRange(stem);
    if (!yr) continue;
    const totalTx = translateXUpTo(stem, measure);
    const sn = stem.closest('.vf-stavenote, .vf-staveNote');
    const snDx = sn && measure.contains(sn) ? readElementTranslateX(sn) : 0;
    const ownDx = readElementTranslateX(stem);
    // natural: align/contain 이후 후처리 translate만 제거해 빔 path(원좌표)와 매칭.
    // - stavenote 안 줄기 → 부모 note dx 제거
    // - 고아 줄기 → 자체 dx 제거(id 짝으로 note와 같이 옮긴 뒤에도 빔 매칭이 깨지지 않게)
    const postHocDx = sn && measure.contains(sn) ? snDx : ownDx;
    const naturalX = localX + (totalTx - postHocDx);
    const effectiveX = localX + totalTx;
    tips.push({
      el: stem,
      naturalX,
      effectiveX,
      dx: postHocDx,
      y0: yr.y0,
      y1: yr.y1,
    });
  }
  return tips;
}

/** 빔 path에서 좌·우 끝 y 목록을 보간해 x에서의 가장자리 y를 구한다. */
function beamEdgeYsAtX(d: string, x: number): { outerMin: number; outerMax: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens?.length) return null;
  let cmd = '';
  let expectingX = true;
  let curX = 0;
  let curY = 0;
  for (const tok of tokens) {
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tok)) {
      cmd = tok;
      expectingX = true;
      continue;
    }
    const n = parseFloat(tok);
    if (!Number.isFinite(n)) continue;
    if (cmd === 'H' || cmd === 'h') {
      curX = cmd === 'h' ? curX + n : n;
      xs.push(curX);
      ys.push(curY);
      continue;
    }
    if (cmd === 'V' || cmd === 'v') {
      curY = cmd === 'v' ? curY + n : n;
      xs.push(curX);
      ys.push(curY);
      continue;
    }
    if (expectingX) {
      curX = n;
      expectingX = false;
    } else {
      curY = n;
      expectingX = true;
      xs.push(curX);
      ys.push(curY);
    }
  }
  if (xs.length < 2) return null;
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  if (right - left < 1) return null;
  const leftYs = ys.filter((_, i) => Math.abs(xs[i]! - left) < 1.5);
  const rightYs = ys.filter((_, i) => Math.abs(xs[i]! - right) < 1.5);
  if (!leftYs.length || !rightYs.length) return null;
  const t = Math.max(0, Math.min(1, (x - left) / (right - left)));
  const minL = Math.min(...leftYs);
  const maxL = Math.max(...leftYs);
  const minR = Math.min(...rightYs);
  const maxR = Math.max(...rightYs);
  return {
    outerMin: minL + t * (minR - minL),
    outerMax: maxL + t * (maxR - maxL),
  };
}

/** 빔 폴리곤 중앙선의 y를 x에서 보간(진단·호환용). */
function beamCenterYAtX(d: string, x: number): number | null {
  const edges = beamEdgeYsAtX(d, x);
  if (!edges) return null;
  return (edges.outerMin + edges.outerMax) / 2;
}

/**
 * 줄기 tip이 닿아야 할 빔 **바깥 가장자리** y.
 * stem-up → min y(음머리에서 먼 쪽), stem-down → max y.
 * 중앙(center)에 맞추면 tip이 빔 두께 중간에 끝나 떠 있는 것처럼 보이고 4분음처럼 읽힌다.
 */
function beamOuterTipYAtX(d: string, x: number, stemUp: boolean): number | null {
  const edges = beamEdgeYsAtX(d, x);
  if (!edges) return null;
  return stemUp ? edges.outerMin : edges.outerMax;
}

/**
 * 줄기 tip(음머리에서 먼 쪽)만 tipY로 옮긴다. base(음머리 쪽)는 절대 건드리지 않음.
 * tipY 근접 휴리스틱(towardUp)은 tip이 base 쪽에 가까우면 밑동을 밀어 머리와 떨어뜨리므로 금지.
 */
function setStemTipY(stemEl: Element, tipY: number, stemUp: boolean): void {
  for (const path of stemEl.querySelectorAll('path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*L\s*([-\d.eE+]+)\s+([-\d.eE+]+)/i.exec(d.trim());
    if (!m) continue;
    const x1 = m[1]!;
    const y1 = parseFloat(m[2]!);
    const x2 = m[3]!;
    const y2 = parseFloat(m[4]!);
    if (!Number.isFinite(y1) || !Number.isFinite(y2)) continue;
    if (stemUp) {
      // tip = min y
      if (y1 <= y2) path.setAttribute('d', `M${x1} ${tipY}L${x2} ${y2}`);
      else path.setAttribute('d', `M${x1} ${y1}L${x2} ${tipY}`);
    } else {
      // tip = max y
      if (y1 >= y2) path.setAttribute('d', `M${x1} ${tipY}L${x2} ${y2}`);
      else path.setAttribute('d', `M${x1} ${y1}L${x2} ${tipY}`);
    }
  }
  for (const line of stemEl.querySelectorAll('line')) {
    const y1 = parseFloat(line.getAttribute('y1') ?? '');
    const y2 = parseFloat(line.getAttribute('y2') ?? '');
    if (!Number.isFinite(y1) || !Number.isFinite(y2)) continue;
    if (stemUp) {
      if (y1 <= y2) line.setAttribute('y1', String(tipY));
      else line.setAttribute('y2', String(tipY));
    } else if (y1 >= y2) line.setAttribute('y1', String(tipY));
    else line.setAttribute('y2', String(tipY));
  }
}

/** 줄기 base(음머리 쪽)만 baseY로 맞춘다. tip은 유지. */
function setStemBaseY(stemEl: Element, baseY: number, stemUp: boolean): void {
  for (const path of stemEl.querySelectorAll('path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*L\s*([-\d.eE+]+)\s+([-\d.eE+]+)/i.exec(d.trim());
    if (!m) continue;
    const x1 = m[1]!;
    const y1 = parseFloat(m[2]!);
    const x2 = m[3]!;
    const y2 = parseFloat(m[4]!);
    if (!Number.isFinite(y1) || !Number.isFinite(y2)) continue;
    if (stemUp) {
      // base = max y
      if (y1 >= y2) path.setAttribute('d', `M${x1} ${baseY}L${x2} ${y2}`);
      else path.setAttribute('d', `M${x1} ${y1}L${x2} ${baseY}`);
    } else {
      // base = min y
      if (y1 <= y2) path.setAttribute('d', `M${x1} ${baseY}L${x2} ${y2}`);
      else path.setAttribute('d', `M${x1} ${y1}L${x2} ${baseY}`);
    }
  }
  for (const line of stemEl.querySelectorAll('line')) {
    const y1 = parseFloat(line.getAttribute('y1') ?? '');
    const y2 = parseFloat(line.getAttribute('y2') ?? '');
    if (!Number.isFinite(y1) || !Number.isFinite(y2)) continue;
    if (stemUp) {
      if (y1 >= y2) line.setAttribute('y1', String(baseY));
      else line.setAttribute('y2', String(baseY));
    } else if (y1 <= y2) line.setAttribute('y1', String(baseY));
    else line.setAttribute('y2', String(baseY));
  }
}

/** VexFlow 고아 stem id `vf-auto123-stem` → stavenote id `vf-auto123`. */
function stavenoteIdForOrphanStem(stemEl: Element): string | null {
  const id = stemEl.id || '';
  const m = /^(.*)-stem\d*$/i.exec(id);
  return m?.[1] && m[1].length > 0 ? m[1] : null;
}

/** VexFlow 고아 ledger id `vf-auto123ledgers` → stavenote id `vf-auto123`. */
function stavenoteIdForOrphanLedgers(ledgerEl: Element): string | null {
  const id = ledgerEl.id || '';
  const m = /^(.*)ledgers$/i.exec(id);
  return m?.[1] && m[1].length > 0 ? m[1] : null;
}

/** 음머리 path 첫 M의 Y — 화음은 여러 머리가 있으므로 stem 방향별 base용은 noteheadStemBaseY 사용. */
function noteheadPitchYs(stavenote: Element): number[] {
  const ys: number[] = [];
  for (const path of stavenote.querySelectorAll('.vf-notehead path, [class*="vf-notehead"] path')) {
    const hd = path.getAttribute('d');
    if (!hd) continue;
    const first = /M\s*[-\d.eE+]+\s+([-\d.eE+]+)/i.exec(hd);
    if (!first) continue;
    const y = parseFloat(first[1]!);
    if (Number.isFinite(y)) ys.push(y);
  }
  return ys;
}

function noteheadPitchY(stavenote: Element): number | null {
  const ys = noteheadPitchYs(stavenote);
  return ys.length ? ys[0]! : null;
}

/**
 * 줄기 밑동이 붙어야 할 음머리 Y.
 * stem-up → 가장 아래 머리(max Y), stem-down → 가장 위 머리(min Y).
 * 첫 머리만 쓰면 화음(C4+F4)에서 밑동이 아랫음으로 끌려 윗음 줄기가 끊긴다.
 */
function noteheadStemBaseY(stavenote: Element, stemUp: boolean): number | null {
  const ys = noteheadPitchYs(stavenote);
  if (!ys.length) return null;
  return stemUp ? Math.max(...ys) : Math.min(...ys);
}

function snapStemTipsToBeamsInMeasure(measure: Element, tips: StemTip[]): void {
  type BeamInfo = { d: string; left: number; right: number; w: number; midY: number };
  const beams: BeamInfo[] = [];
  for (const beam of measure.querySelectorAll(':scope > .vf-beam, :scope > [class*="vf-beam"]')) {
    for (const path of beam.querySelectorAll('path')) {
      const d = path.getAttribute('d');
      if (!d) continue;
      const xs = [...d.matchAll(/[MmLl]\s*([-\d.eE+]+)/g)].map((m) => parseFloat(m[1]!));
      const ys = [...d.matchAll(/[MmLl]\s*[-\d.eE+]+\s+([-\d.eE+]+)/g)].map((m) => parseFloat(m[1]!));
      if (xs.length < 2) continue;
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const w = right - left;
      if (w < 1) continue;
      beams.push({
        d,
        left,
        right,
        w,
        midY: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0,
      });
    }
  }
  if (!beams.length) return;

  for (const tip of tips) {
    const covering = beams.filter(
      (b) =>
        tip.effectiveX >= b.left - 6 &&
        tip.effectiveX <= b.right + 6 &&
        stemShaftCrossesBeamY(tip, b.midY, 36),
    );
    if (!covering.length) continue;
    // 가장 넓은 빔 = 1차(primary). 2차는 tip을 음머리 쪽으로 당겨 끊겨 보이게 함.
    covering.sort((a, b) => b.w - a.w);
    const best = covering[0]!;
    const tipUp = Math.min(tip.y0, tip.y1);
    const tipDown = Math.max(tip.y0, tip.y1);
    // stem-up: tip이 더 작은 y. stem 길이가 충분하면 tipUp이 tipDown보다 빔에 가깝다.
    const stemUp = Math.abs(tipUp - best.midY) <= Math.abs(tipDown - best.midY);
    const actualTip = stemUp ? tipUp : tipDown;
    const otherEnd = stemUp ? tipDown : tipUp;
    if (Math.abs(best.midY - actualTip) > Math.abs(best.midY - otherEnd) + 2) continue;
    const targetY = beamOuterTipYAtX(best.d, tip.effectiveX, stemUp);
    if (targetY == null || !Number.isFinite(targetY)) continue;
    // 이미 바깥 가장자리에 닿거나 넘어가면 그대로(단축 금지 — 중앙 스냅이 끊김의)
    if (stemUp) {
      if (actualTip <= targetY + 1.2) continue;
      if (actualTip - targetY > 48) continue;
    } else {
      if (actualTip >= targetY - 1.2) continue;
      if (targetY - actualTip > 48) continue;
    }
    setStemTipY(tip.el, targetY, stemUp);
  }
}

function syncVfEngravingInMeasure(measure: Element): void {
  const stavenotes = [
    ...measure.querySelectorAll(':scope > .vf-stavenote, :scope > .vf-staveNote'),
  ] as SVGGraphicsElement[];
  if (!stavenotes.length) return;

  type NoteShift = { el: SVGGraphicsElement; naturalX: number; dx: number; hasInnerStem: boolean };
  const notes: NoteShift[] = [];
  for (const sn of stavenotes) {
    const dx = readElementTranslateX(sn);
    const center = noteheadCenterXInSvgRoot(sn) ?? restCenterXInSvgRoot(sn);
    if (center == null || !Number.isFinite(center)) continue;
    notes.push({
      el: sn,
      naturalX: center - dx,
      dx,
      hasInnerStem: !!sn.querySelector('.vf-stem, [class*="vf-stem"]'),
    });
  }
  if (!notes.length) return;

  const stemTips = collectStemTipsInMeasure(measure);

  // 고아 stem → 같은 id stavenote dx(같은 onset 다른 voice X-only 오매칭 방지)
  const noteById = new Map(notes.map((n) => [n.el.id, n]));
  const nearestNote = (stemEl: Element, x: number, stemBaseY: number): NoteShift | null => {
    const id = stavenoteIdForOrphanStem(stemEl);
    if (id) {
      const byId = noteById.get(id);
      if (byId) return byId;
    }
    // Softmax 고아 줄기(naturalX=원좌표)는 remesh된 음머리(natural≈effective)에 매칭.
    // 예전에 “속줄기 없는 음”만 1순위로 보면, Softmax X에서 먼 빈 음표에 붙어
    // 16분 꼬리가 앞 그룹 줄기로 끌림(m4 PL Softmax217→199). 속줄기 페널티만 두고 최단 dX 우선.
    let best: NoteShift | null = null;
    let bestScore = Infinity;
    for (const n of notes) {
      const dX = Math.abs(n.naturalX - x);
      if (dX > 40) continue;
      const ys = noteheadPitchYs(n.el);
      const dY =
        ys.length > 0
          ? Math.min(...ys.map((y) => Math.abs(y - stemBaseY)))
          : 20;
      const stemPenalty = n.hasInnerStem ? 6 : 0;
      const score = dX + dY * 0.35 + stemPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (best) return best;
    let bestX: NoteShift | null = null;
    let bestDist = Infinity;
    for (const n of notes) {
      const d = Math.abs(n.naturalX - x);
      if (d < bestDist) {
        bestDist = d;
        bestX = n;
      }
    }
    if (!bestX || bestDist > 40) return null;
    return bestX;
  };

  for (const tip of stemTips) {
    // stavenote 안 줄기는 부모 translate로 이미 이동 — 추가 translate 금지
    if (tip.el.closest('.vf-stavenote, .vf-staveNote')) continue;
    // stem-up 고아 줄기의 밑동은 보통 max y (stem-down은 대개 stavenote 내부)
    const baseY = Math.max(tip.y0, tip.y1);
    const note = nearestNote(tip.el, tip.naturalX, baseY);
    if (!note) continue;
    const cur = readElementTranslateX(tip.el);
    const need = note.dx - cur;
    if (Math.abs(need) >= 0.01) applySvgTranslateX(tip.el as SVGGraphicsElement, need, Math.abs(need) + 1);
  }

  // 고아 보조선(.vf-ledgers) — 짝 stavenote와 같은 dx (음머리 이동 후 따라감)
  for (const led of measure.querySelectorAll(':scope > .vf-ledgers, :scope > [class*="vf-ledgers"]')) {
    if (led.closest('.vf-stavenote, .vf-staveNote')) continue;
    const id = stavenoteIdForOrphanLedgers(led);
    const note = (id && noteById.get(id)) || null;
    if (!note) continue;
    const cur = readElementTranslateX(led as SVGGraphicsElement);
    const need = note.dx - cur;
    if (Math.abs(need) >= 0.01) {
      applySvgTranslateX(led as SVGGraphicsElement, need, Math.abs(need) + 1);
    }
  }

  // stem tip 재수집(형제 stem translate 반영)
  const tipsAfter = collectStemTipsInMeasure(measure);
  // hook/2차 분류용만 — pad·orphan·매칭 px는 건드리지 않음
  const hookMaxW = hookMaxWidthFromTips(tipsAfter);
  const gapHintEarly = medianAdjacentStemGap(tipsAfter);
  // Softmax forward hook는 zoom↑ 시 hookMaxW를 넘김 — 평행 dx 상한도 같이 키움
  const hookClassCeil = Math.max(12, gapHintEarly != null ? gapHintEarly * 0.75 : 12);

  // 평행 시프트(조표 침범 등): 모든 note dx가 같으면 빔·이음줄도 같은 dx로 옮김
  // (짧은 hook은 reshape 스킵이라 안 따라가면 "온쉼표/빔 파편"처럼 남음)
  const noteDxs = notes.map((n) => n.dx);
  const dxMin = Math.min(...noteDxs);
  const dxMax = Math.max(...noteDxs);
  const parallelDx = noteDxs.length > 0 && dxMax - dxMin < 1.0 ? (dxMin + dxMax) / 2 : null;

  const translateOrphanEngraving = (el: Element, dx: number): void => {
    if (Math.abs(dx) < 0.01) return;
    const cur = readElementTranslateX(el as SVGGraphicsElement);
    const need = dx - cur;
    if (Math.abs(need) >= 0.01) {
      applySvgTranslateX(el as SVGGraphicsElement, need, Math.abs(need) + 1);
    }
  };

  if (parallelDx != null && Math.abs(parallelDx) >= 0.5) {
    for (const beam of measure.querySelectorAll('.vf-beam, [class*="vf-beam"]')) {
      if (beam.closest('.vf-stavenote, .vf-staveNote')) continue;
      // 짧은 hook는 평행 dx로 또 밀면 2차 align에서 옆 줄기로 간다 → tip 고정만
      let bw = 0;
      let left = 0;
      let right = 0;
      for (const path of beam.querySelectorAll('path')) {
        const d = path.getAttribute('d');
        if (!d) continue;
        const xs = [...d.matchAll(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)].map((m) =>
          parseFloat(m[1]!),
        );
        if (xs.length >= 2) {
          const lo = Math.min(...xs);
          const hi = Math.max(...xs);
          if (hi - lo > bw) {
            bw = hi - lo;
            left = lo;
            right = hi;
          }
        }
      }
      // Softmax hook(폭≤hookClassCeil)는 평행 dx로 밀면 Softmax 자유단이 옆 tip에 닿아
      // alreadyTol/bestR이 부착을 점8로 뒤집음. tip lock + attachSide로만 추종.
      if (bw > 0 && bw < hookClassCeil) continue;
      // 이미 effective tip에 붙은 1·2차 빔은 재평행 금지(2차 align에서 dx 중복 → hook 오부착)
      const btx = readElementTranslateX(beam as SVGGraphicsElement);
      const visL = left + btx;
      const visR = right + btx;
      const tipNear = (x: number) =>
        tipsAfter.some((t) => Math.abs(t.effectiveX - x) <= 3);
      if (bw >= hookMaxW && tipNear(visL) && tipNear(visR)) continue;
      translateOrphanEngraving(beam, parallelDx);
    }
    for (const tie of measure.querySelectorAll('.vf-stavetie, [class*="vf-tie"]')) {
      if (tie.closest('.vf-stavenote, .vf-staveNote')) continue;
      translateOrphanEngraving(tie, parallelDx);
    }
  } else {
    // 짧은 hook/이음줄: reshape 대신 가장 가까운 줄기/음표 dx로 translate
    const shortEngravingDx = (el: Element): number | null => {
      const paths = [...el.querySelectorAll('path')];
      let midX: number | null = null;
      let width = 0;
      for (const path of paths) {
        const d = path.getAttribute('d');
        if (!d) continue;
        const xs: number[] = [];
        const xToks = d.match(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g);
        if (!xToks) continue;
        for (const m of xToks) {
          const n = parseFloat(m.replace(/[MmLl]\s*/, ''));
          if (Number.isFinite(n)) xs.push(n);
        }
        if (xs.length >= 1) {
          const left = Math.min(...xs);
          const right = Math.max(...xs);
          width = Math.max(width, right - left);
          midX = (left + right) / 2;
        }
      }
      if (midX == null || width >= hookMaxW) return null;
      // 줄기 tip 우선
      let bestTip: StemTip | null = null;
      let bestTipD = Infinity;
      for (const t of tipsAfter) {
        const d = Math.abs(t.naturalX - midX);
        if (d < bestTipD) {
          bestTipD = d;
          bestTip = t;
        }
      }
      if (bestTip && bestTipD < 48) return bestTip.dx;
      let best: NoteShift | null = null;
      let bestD = Infinity;
      for (const n of notes) {
        const d = Math.abs(n.naturalX - midX);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best && bestD < 64 ? best.dx : null;
    };
    // 빔 hook는 midX→natural translate 금지(2차 align에서 옆 줄기로 밀림). tip 고정만.
    for (const tie of measure.querySelectorAll('.vf-stavetie, [class*="vf-tie"]')) {
      if (tie.closest('.vf-stavenote, .vf-staveNote')) continue;
      const dx = shortEngravingDx(tie);
      if (dx != null) translateOrphanEngraving(tie, dx);
    }
  }

  const reshapeByStemTips = (
    el: Element,
    opts: { pad?: number; mode: 'primary' | 'secondary' },
  ): void => {
    const pad = opts.pad ?? 8;
    const primary = opts.mode === 'primary';
    // path는 로컬 좌표, el translate는 별도.
    const beamTx = readElementTranslateX(el as SVGGraphicsElement);
    const paths = [...el.querySelectorAll('path')];
    if (!paths.length) return;

    for (const path of paths) {
      const d = path.getAttribute('d');
      if (!d) continue;
      const xs: number[] = [];
      const ys: number[] = [];
      const xToks = d.match(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g);
      if (xToks) {
        for (const m of xToks) {
          const n = parseFloat(m.replace(/[MmLl]\s*/, ''));
          if (Number.isFinite(n)) xs.push(n);
        }
      }
      const yToks = d.match(/[MmLl]\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g);
      if (yToks) {
        for (const m of yToks) {
          const parts = m.trim().split(/\s+/);
          const n = parseFloat(parts[parts.length - 1]!);
          if (Number.isFinite(n)) ys.push(n);
        }
      }
      if (xs.length < 2) continue;
      const oldLeft = Math.min(...xs);
      const oldRight = Math.max(...xs);
      if (oldRight - oldLeft < 1) continue;
      const origW = oldRight - oldLeft;
      // Partial / hook: reshape 금지(아래에서 줄기 tip에 강체 고정).
      if (origW < hookMaxW) continue;
      const beamY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
      const yOk = (t: StemTip) => ys.length === 0 || stemShaftCrossesBeamY(t, beamY);

      // Softmax span 기억: remesh 후 path가 tip 좌표로 바뀌어도 natural 매칭 유지
      const storedNat = beamNaturalSpanByEl.get(el);
      const matchL = storedNat?.left ?? oldLeft;
      const matchR = storedNat?.right ?? oldRight;

      // Softmax path↔naturalX(1차 remesh 직후). 이미 reshape된 path↔effectiveX(2차 align).
      // naturalX를 항상 우선하면 remesh된 path 구간에 Softmax 좌표만 겹치는 줄기만
      // 잡혀 1차가 16–16만 남거나(m13 T/B), 옆 그룹 effective로 늘어남(m13 PR).
      // 고아 stem: OSMD가 줄기를 stavenote 밖에 둠 — Softmax natural만 맞는 고아를 빼면
      // 1차 빔이 Softmax에 남고 16분 꼬리만 remesh tip을 따라가 옆 줄기에 붙은 것처럼 보임(m4 PL).
      const inNote = (t: StemTip) => !!t.el.closest('.vf-stavenote, .vf-staveNote');
      const beamableStem = (t: StemTip) =>
        inNote(t) || !!stavenoteIdForOrphanStem(t.el);
      const byNatural = tipsAfter.filter(
        (t) =>
          beamableStem(t) &&
          t.naturalX >= matchL - 4 &&
          t.naturalX <= matchR + 4 &&
          yOk(t),
      );
      const byEffective = tipsAfter.filter(
        (t) =>
          beamableStem(t) &&
          t.effectiveX >= oldLeft - 4 &&
          t.effectiveX <= oldRight + 4 &&
          yOk(t),
      );
      const endErr = (tips: StemTip[], ref: (t: StemTip) => number, l: number, r: number): number => {
        if (tips.length < 2) return Infinity;
        const xs = tips.map(ref);
        return Math.abs(Math.min(...xs) - l) + Math.abs(Math.max(...xs) - r);
      };
      const natErr = endErr(byNatural, (t) => t.naturalX, matchL, matchR);
      const effErr = endErr(byEffective, (t) => t.effectiveX, oldLeft, oldRight);
      let matched: StemTip[];
      let matchByEffective: boolean;
      // Softmax span이 기억돼 있으면 remesh된 path effective 매칭보다 natural 추종 우선
      if (storedNat && byNatural.length >= 2) {
        matched = byNatural;
        matchByEffective = false;
      } else if (byNatural.length >= 2 && byEffective.length >= 2) {
        // Softmax path: natural 우선(effective 구간 안 옆음 유입 방지).
        // 이미 reshape된 path: effective 양끝 오차가 명확히 작을 때만 전환.
        if (effErr < natErr - 0.5) {
          matched = byEffective;
          matchByEffective = true;
        } else if (byNatural.length > byEffective.length && natErr <= effErr + 8) {
          matched = byNatural;
          matchByEffective = false;
        } else {
          matched = byNatural;
          matchByEffective = false;
        }
      } else if (byNatural.length >= 2) {
        matched = byNatural;
        matchByEffective = false;
      } else if (byEffective.length >= 2) {
        matched = byEffective;
        matchByEffective = true;
      } else {
        matched = [];
        matchByEffective = false;
      }

      if (!matchByEffective) {
        const stemAtBeamStart = matched.some((t) => Math.abs(t.naturalX - matchL) <= 4);
        if (!stemAtBeamStart && matched.length >= 1) {
          const orphans = tipsAfter.filter((t) => {
            if (!yOk(t) || !beamableStem(t)) return false;
            const gap = matchL - t.naturalX;
            return gap > 4 && gap <= 14;
          });
          if (orphans.length) matched = [...orphans, ...matched];
        }
      }

      if (matched.length < 2) {
        const refX = (t: StemTip) => (matchByEffective ? t.effectiveX : t.naturalX);
        const targetL = matchByEffective ? oldLeft : matchL;
        const targetR = matchByEffective ? oldRight : matchR;
        const byLeft = tipsAfter
          .filter((t) => yOk(t) && beamableStem(t))
          .slice()
          .sort((a, b) => Math.abs(refX(a) - targetL) - Math.abs(refX(b) - targetL));
        const leftCand = byLeft[0];
        const byRight = tipsAfter
          .filter((t) => yOk(t) && beamableStem(t))
          .slice()
          .sort((a, b) => Math.abs(refX(a) - targetR) - Math.abs(refX(b) - targetR));
        const rightCand = byRight.find((t) => t !== leftCand) ?? byRight[0];
        if (
          leftCand &&
          rightCand &&
          leftCand !== rightCand &&
          Math.abs(refX(leftCand) - targetL) <= pad &&
          Math.abs(refX(rightCand) - targetR) <= pad
        ) {
          matched = [leftCand, rightCand];
        }
      }
      if (matched.length < 2) continue;

      if (!matchByEffective && !storedNat) {
        beamNaturalSpanByEl.set(el, { left: matchL, right: matchR });
      }

      const tipRef = (t: StemTip) => (matchByEffective ? t.effectiveX : t.naturalX);
      let newLeft: number;
      let newRight: number;
      if (primary) {
        // 1차 빔: span 안 멤버 전체 — 양끝만 쓰면 remesh 후 긴 빔이 조각남(m13 T/B).
        newLeft = Math.min(...matched.map((t) => t.effectiveX));
        newRight = Math.max(...matched.map((t) => t.effectiveX));
      } else {
        // 2차/부분: 원래 빔 양끝에 가장 가까운 줄기만 (1차로 늘어남 방지)
        let leftTip = matched[0]!;
        let rightTip = matched[0]!;
        let leftDist = Infinity;
        let rightDist = Infinity;
        for (const t of matched) {
          const dL = Math.abs(tipRef(t) - oldLeft);
          const dR = Math.abs(tipRef(t) - oldRight);
          if (dL < leftDist - 0.05 || (Math.abs(dL - leftDist) <= 0.05 && tipRef(t) < tipRef(leftTip))) {
            leftDist = dL;
            leftTip = t;
          }
          if (dR < rightDist - 0.05 || (Math.abs(dR - rightDist) <= 0.05 && tipRef(t) > tipRef(rightTip))) {
            rightDist = dR;
            rightTip = t;
          }
        }
        const minRef = Math.min(...matched.map(tipRef));
        const maxRef = Math.max(...matched.map(tipRef));
        const leftOverhang = oldLeft < minRef - 2;
        const rightOverhang = oldRight > maxRef + 2;
        if (leftOverhang) {
          leftTip = matched.reduce((a, b) => (tipRef(a) <= tipRef(b) ? a : b));
          leftDist = Math.abs(tipRef(leftTip) - oldLeft);
        }
        if (rightOverhang) {
          rightTip = matched.reduce((a, b) => (tipRef(a) >= tipRef(b) ? a : b));
          rightDist = Math.abs(tipRef(rightTip) - oldRight);
        }
        if (leftTip === rightTip) continue;
        if (!leftOverhang && leftDist > 12) continue;
        if (!rightOverhang && rightDist > 12) continue;
        newLeft = Math.min(leftTip.effectiveX, rightTip.effectiveX);
        newRight = Math.max(leftTip.effectiveX, rightTip.effectiveX);
      }
      if (newRight - newLeft < 1) continue;
      const maxGrow = primary
        ? matchByEffective
          ? origW * 1.2 + 4 // 이미 sync된 path — 옆 그룹으로 늘어남 금지
          : origW * 2.5 + 20
        : origW * 1.35 + 8;
      if (newRight - newLeft > maxGrow) continue;
      // 이미 remesh·reshape되어 양끝이 줄기에 붙은 path: 멤버 일부만 남아 붕괴 금지.
      // Softmax path의 앞쪽 overhang 수축(70→100)은 alreadyFit=false 라서 허용.
      if (
        matchByEffective &&
        primary &&
        origW >= 16 &&
        newRight - newLeft < origW * 0.65
      ) {
        const minEff = Math.min(...matched.map((t) => t.effectiveX));
        const maxEff = Math.max(...matched.map((t) => t.effectiveX));
        const alreadyFit =
          Math.abs(oldLeft - minEff) <= 4 && Math.abs(oldRight - maxEff) <= 4;
        if (alreadyFit) continue;
      }
      if (
        Math.abs(newLeft - (oldLeft + beamTx)) < 0.35 &&
        Math.abs(newRight - (oldRight + beamTx)) < 0.35 &&
        Math.abs(beamTx) < 0.35
      ) {
        continue;
      }

      const mapX = (x: number) => {
        const t = (x - oldLeft) / (oldRight - oldLeft);
        return newLeft + t * (newRight - newLeft);
      };
      path.setAttribute('d', mapSvgPathXs(d, mapX));
      if (Math.abs(beamTx) >= 0.01) clearStavenoteTranslateX(el as SVGGraphicsElement);
    }
  };

  type BeamClass = 'primary' | 'secondary' | 'hook';
  const beamClass = new Map<Element, BeamClass>();
  /** classify 시점 Softmax 1차 span — reshape 후에도 hook 부착 판별에 사용 */
  const primarySoftmaxSpans = new Map<
    Element,
    { left: number; right: number; midY: number; center: number }
  >();
  {
    type G = { el: Element; left: number; right: number; w: number; midY: number };
    const geoms: G[] = [];
    for (const beam of measure.querySelectorAll('.vf-beam, [class*="vf-beam"]')) {
      if (beam.closest('.vf-stavenote, .vf-staveNote')) continue;
      const path = beam.querySelector('path');
      const d = path?.getAttribute('d');
      if (!d) continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const m of d.matchAll(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) xs.push(n);
      }
      for (const m of d.matchAll(
        /[MmLl]\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g,
      )) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) ys.push(n);
      }
      if (xs.length < 2) continue;
      const btx = readElementTranslateX(beam as SVGGraphicsElement);
      const L = Math.min(...xs) + btx;
      const R = Math.max(...xs) + btx;
      geoms.push({
        el: beam,
        left: L,
        right: R,
        w: R - L,
        midY: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0,
      });
    }
    // Softmax 꼬리는 zoom↑ 시 픽셀 폭이 hookMaxW(≤12)를 넘김 — 고정 12면 secondary로
    // remesh되어 점8까지 늘어남. 인접 간격 기준으로 Softmax hook 상한을 키움.
    for (const g of geoms) {
      const yOk = (t: StemTip) => stemShaftCrossesBeamY(t, g.midY);
      const onAnyTip = (x: number) =>
        tipsAfter.some(
          (t) => yOk(t) && (Math.abs(t.effectiveX - x) <= 2.75 || Math.abs(t.naturalX - x) <= 2.75),
        );
      const leftOnTip = onAnyTip(g.left);
      const rightOnTip = onAnyTip(g.right);

      const tipNearNat = (x: number) =>
        tipsAfter.find((t) => yOk(t) && Math.abs(t.naturalX - x) <= 1.2);
      const tipNearEff = (x: number) =>
        tipsAfter.find((t) => yOk(t) && Math.abs(t.effectiveX - x) <= 1.2);
      const tL_nat = tipNearNat(g.left);
      const tR_nat = tipNearNat(g.right);
      const tL_eff = tipNearEff(g.left);
      const tR_eff = tipNearEff(g.right);
      const connectsTwoStems =
        (tL_nat != null && tR_nat != null && tL_nat !== tR_nat) ||
        (tL_eff != null && tR_eff != null && tL_eff !== tR_eff);

      const underWiderEarly = geoms.some(
        (o) =>
          o.el !== g.el &&
          o.w > g.w + 2 &&
          Math.abs(o.midY - g.midY) < 12 &&
          o.left < g.right - 2 &&
          o.right > g.left + 2,
      );

      // 1차 빔 아래에서 두 줄기를 잇는 빔(natural 또는 effective 좌표에서 양 끝이 줄기에 닿음)은
      // 좁은 간격이나 줄기 오프셋으로 인해 hook으로 오분류되지 않고 확실한 2차 빔으로 분류.
      if (connectsTwoStems && underWiderEarly) {
        beamClass.set(g.el, 'secondary');
        continue;
      }

      // remesh로 Softmax 1차가 hookMaxW 아래로 짧아져도 Softmax span이 넓으면 1차 유지
      // (아니면 flip/coverPrim이 앞 그룹을 고르고 forward 꼬리가 뒤집힘 — zoom마다 16↔점8)
      const storedSpan = beamNaturalSpanByEl.get(g.el);
      const softW = storedSpan ? storedSpan.right - storedSpan.left : 0;
      const classW = softW > g.w + 1 ? softW : g.w;
      // remesh 후 Softmax hook이 hookMaxW를 넘겨도, 한쪽 tip만 닿으면 hook 유지
      // tip에서 떨어진 Softmax hook(고아)도 hook로 두어 rescue 스냅 대상이 되게 함
      const oneEndedHook =
        classW <= hookClassCeil && classW >= 2 && leftOnTip !== rightOnTip;
      const orphanShortHook =
        classW <= hookClassCeil && classW >= 2 && !leftOnTip && !rightOnTip;
      if (classW < hookMaxW || oneEndedHook || orphanShortHook) {
        // remesh로 짧아진 2차(양 끝 tip + 더 넓은 1차 아래)만 secondary.
        // Softmax hook가 좁아진 점8–16 간격을 뚫고 양 tip에 닿아도 hook 유지.
        // 단 Softmax hook 자유단만 옆 tip에 근접한 경우(폭 << tip간격)는 hook로 남겨
        // 2차 pass에서 secondary remesh로 16–8에 늘어나지 않게 함.
        if (!oneEndedHook && !orphanShortHook && leftOnTip && rightOnTip && classW >= 5) {
          const tipNear = (x: number) =>
            tipsAfter.find(
              (t) => yOk(t) && (Math.abs(t.effectiveX - x) <= 2.75 || Math.abs(t.naturalX - x) <= 2.75),
            );
          const tL = tipNear(g.left);
          const tR = tipNear(g.right);
          if (tL && tR && tL !== tR) {
            const tipSpan = Math.abs(tR.effectiveX - tL.effectiveX);
            const natSpan = Math.abs(tR.naturalX - tL.naturalX);
            const refSpan = Math.max(tipSpan, natSpan);
            if (classW < refSpan - 2.5) {
              beamClass.set(g.el, 'hook');
              continue;
            }
          }
          const underWider = geoms.some(
            (o) =>
              o.el !== g.el &&
              o.w > g.w + 2 &&
              Math.abs(o.midY - g.midY) < 12 &&
              o.left < g.right - 2 &&
              o.right > g.left + 2,
          );
          if (underWider) {
            beamClass.set(g.el, 'secondary');
            continue;
          }
        }
        beamClass.set(g.el, 'hook');
        continue;
      }
      const underWider = geoms.some(
        (o) =>
          o.el !== g.el &&
          o.w > g.w + 2 &&
          Math.abs(o.midY - g.midY) < 12 &&
          o.left < g.right - 2 &&
          o.right > g.left + 2,
      );
      // Softmax hook(≤ceil)가 remesh로 짧아진 1차보다 길어 primary로 승격되지 않게.
      // 단 양 tip에 닿는 빔은 진짜 1차 — 작은 zoom에서 Softmax 1차(≤12)가 Softmax hook과
      // 겹친다고 hook로 강등되면 coverPrim이 비어 forward 꼬리가 점8에 붙음.
      if (!underWider && classW <= hookClassCeil && !(leftOnTip && rightOnTip)) {
        const overlapsSibling = geoms.some(
          (o) =>
            o.el !== g.el &&
            Math.abs(o.midY - g.midY) < 12 &&
            o.left < g.right - 1 &&
            o.right > g.left + 1,
        );
        if (overlapsSibling) {
          beamClass.set(g.el, 'hook');
          continue;
        }
      }
      // Softmax hook가 zoom↑로 hookClassCeil을 넘겨도, 더 넓은 1차 아래 + tip-to-tip이
      // 아니면 Softmax hook 유지(아니면 Softmax 16–8 Softmax secondary로 remesh됨).
      if (underWider && classW <= Math.max(hookClassCeil, (gapHintEarly ?? 12) * 0.95)) {
        const tipNear = (x: number) =>
          tipsAfter.find(
            (t) => yOk(t) && (Math.abs(t.effectiveX - x) <= 2.75 || Math.abs(t.naturalX - x) <= 2.75),
          );
        const tL = tipNear(g.left);
        const tR = tipNear(g.right);
        const tipSpan =
          tL && tR && tL !== tR ? Math.abs(tR.effectiveX - tL.effectiveX) : null;
        const trueSecondary =
          tipSpan != null && leftOnTip && rightOnTip && classW >= tipSpan - 2.5;
        if (!trueSecondary) {
          beamClass.set(g.el, 'hook');
          continue;
        }
      }
      const kind = underWider ? 'secondary' : 'primary';
      beamClass.set(g.el, kind);
      if (kind === 'primary') {
        // Softmax span(reshape가 기억)이 있으면 hook center에 사용 — classify에서 쓰지 않음
        // (classify 때 쓰면 reshape natural 강제 매칭으로 tip remesh가 스킵됨)
        const stored = storedSpan;
        const left = stored?.left ?? g.left;
        const right = stored?.right ?? g.right;
        primarySoftmaxSpans.set(g.el, {
          left,
          right,
          midY: g.midY,
          center: (left + right) / 2,
        });
      }
    }
  }

  for (const beam of measure.querySelectorAll('.vf-beam, [class*="vf-beam"]')) {
    const kind = beamClass.get(beam) ?? 'secondary';
    if (kind === 'hook') continue;
    reshapeByStemTips(beam, { mode: kind === 'primary' ? 'primary' : 'secondary' });
  }
  // 빔 X 맞춤 후, 멤버 줄기 tip이 빔선에 닿도록 y를 연장(끊겨 4분처럼 보이는 증상).
  snapStemTipsToBeamsInMeasure(measure, tipsAfter);
  // tip 스냅/오매칭으로 밑동이 음머리에서 떨어진 고아 줄기 재부착
  reattachOrphanStemBasesToNoteheads(measure, noteById);
  for (const tie of measure.querySelectorAll('.vf-stavetie, [class*="vf-tie"]')) {
    reshapeByStemTips(tie, { mode: 'secondary', pad: 48 });
  }

  // hook: Softmax 1차 span 기준으로 부착 줄기 선택(reshape된 짧은 1차에 속지 않음)
  const tipsForHooks = collectStemTipsInMeasure(measure);
  anchorHookBeamsToStemTips(measure, tipsForHooks, beamClass, primarySoftmaxSpans);

  // hook을 줄기에 맞춘 뒤, 1차 빔 바깥쪽을 향하면 뒤집기
  flipOutwardHooksTowardPrimary(
    measure,
    collectStemTipsInMeasure(measure),
    beamClass,
    primarySoftmaxSpans,
  );
  // 16–8–16 등: 같은 1차 안 hook 길이를 짧게·균일하게 (한쪽만 길면 8분이 16분처럼 보임)
  normalizeHookLengthsInPrimaryGroups(
    measure,
    collectStemTipsInMeasure(measure),
    beamClass,
    primarySoftmaxSpans,
  );
}

/**
 * 짧은 2차 꼬리(hook)가 1차 빔 그룹 바깥을 향하면 path를 줄기 기준 좌우 반전.
 * 16분-8분-16분에서 forward/backward hook이 remesh 후 바깥쪽으로 남는 증상 보정.
 */
function flipOutwardHooksTowardPrimary(
  measure: Element,
  tips: StemTip[],
  beamClass: Map<Element, 'primary' | 'secondary' | 'hook'>,
  primarySoftmaxSpans?: Map<
    Element,
    { left: number; right: number; midY: number; center: number }
  >,
): void {
  type Prim = { left: number; right: number; midY: number; center: number };
  const primaries: Prim[] = primarySoftmaxSpans?.size
    ? [...primarySoftmaxSpans.values()]
    : [];
  if (!primaries.length) {
    for (const [el, kind] of beamClass) {
      if (kind !== 'primary') continue;
      const path = el.querySelector('path');
      const d = path?.getAttribute('d');
      if (!d) continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const m of d.matchAll(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) xs.push(n);
      }
      for (const m of d.matchAll(
        /[MmLl]\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g,
      )) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) ys.push(n);
      }
      if (xs.length < 2) continue;
      const btx = readElementTranslateX(el as SVGGraphicsElement);
      const left = Math.min(...xs) + btx;
      const right = Math.max(...xs) + btx;
      primaries.push({
        left,
        right,
        midY: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0,
        center: (left + right) / 2,
      });
    }
  }
  if (!primaries.length || !tips.length) return;

  for (const [el, kind] of beamClass) {
    if (kind !== 'hook') continue;
    const path = el.querySelector('path');
    const d = path?.getAttribute('d');
    if (!d) continue;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const m of d.matchAll(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
      const n = parseFloat(m[1]!);
      if (Number.isFinite(n)) xs.push(n);
    }
    for (const m of d.matchAll(
      /[MmLl]\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g,
    )) {
      const n = parseFloat(m[1]!);
      if (Number.isFinite(n)) ys.push(n);
    }
    if (xs.length < 2) continue;
    const btx = readElementTranslateX(el as SVGGraphicsElement);
    const left = Math.min(...xs) + btx;
    const right = Math.max(...xs) + btx;
    const w = right - left;
    // beamClass=hook이면 고정 12px 재검사 금지(확대 시 Softmax 꼬리>12도 flip 대상)
    if (w < 1) continue;
    const midY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;

    // 어느 끝이 줄기에 붙는지
    let attachVis = left;
    let freeVis = right;
    let bestStemD = Infinity;
    for (const t of tips) {
      const dL = Math.abs(t.effectiveX - left);
      const dR = Math.abs(t.effectiveX - right);
      if (dL < bestStemD) {
        bestStemD = dL;
        attachVis = left;
        freeVis = right;
      }
      if (dR < bestStemD) {
        bestStemD = dR;
        attachVis = right;
        freeVis = left;
      }
    }
    if (bestStemD > 4) continue;

    // remesh 후 attachVis만 보면 Softmax 앞 그룹 1차 오른끝에 속해 forward hook가 뒤집힘.
    // 부착 tip Softmax natural이 들어가는 1차(Softmax span)를 우선.
    let attachTipNat: number | null = null;
    for (const t of tips) {
      if (!stemShaftCrossesBeamY(t, midY)) continue;
      if (Math.abs(t.effectiveX - attachVis) <= 3) {
        attachTipNat = t.naturalX;
        break;
      }
    }

    // 같은 y 대역의 1차 빔 중 줄기를 포함하는(또는 가장 가까운) 그룹
    let bestPrim: Prim | null = null;
    let bestPrimScore = Infinity;
    for (const p of primaries) {
      if (Math.abs(p.midY - midY) > 14) continue;
      const edge = Math.min(4, Math.max(1.5, (p.right - p.left) * 0.12));
      const contains =
        attachTipNat != null
          ? attachTipNat >= p.left - edge && attachTipNat <= p.right + edge
          : attachVis >= p.left - edge && attachVis <= p.right + edge;
      const dist = contains
        ? 0
        : attachTipNat != null
          ? Math.min(Math.abs(attachTipNat - p.left), Math.abs(attachTipNat - p.right))
          : Math.min(Math.abs(attachVis - p.left), Math.abs(attachVis - p.right));
      const score = contains
        ? Math.abs((attachTipNat ?? attachVis) - p.center) * 0.01
        : 40 + dist;
      if (score < bestPrimScore) {
        bestPrimScore = score;
        bestPrim = p;
      }
    }
    if (!bestPrim) continue;

    // 작은 zoom: 다음 8분 1차가 edge로 침범해도, 꼬리 mid가 그 그룹 밖이면 스킵
    if (
      !(left < bestPrim.right + 2 && right > bestPrim.left - 2) &&
      Math.abs((left + right) / 2 - bestPrim.center) > (bestPrim.right - bestPrim.left) * 0.55
    ) {
      continue;
    }

    const freeDir = Math.sign(freeVis - attachVis);
    // 1차 center는 Softmax(natural) 좌표. attachVis는 align 후 화면 좌표라
    // 그룹이 오른쪽으로 밀리면 center가 첫 줄기보다 왼쪽이 되어 forward 꼬리가 바깥으로 뒤집힌다.
    const attachRef =
      primarySoftmaxSpans?.size && attachTipNat != null ? attachTipNat : attachVis;
    const inwardDir = Math.sign(bestPrim.center - attachRef);
    if (freeDir === 0 || inwardDir === 0 || freeDir === inwardDir) continue;

    // path 로컬에서 부착점 기준 좌우 반전
    const attachLocal = attachVis - btx;
    path.setAttribute(
      'd',
      mapSvgPathXs(d, (x) => 2 * attachLocal - x),
    );
  }
}

/**
 * 같은 1차 빔 아래 16분 꼬리(hook) 길이를 짧게·균일하게.
 * Softmax/remesh로 한쪽 hook만 이웃 8분까지 거의 닿으면 두 줄 빔처럼 보인다.
 * 부착 tip은 유지하고 자유단만 줄인다 — 옆 줄기로 reshape하지 않음.
 */
function normalizeHookLengthsInPrimaryGroups(
  measure: Element,
  tips: StemTip[],
  beamClass: Map<Element, 'primary' | 'secondary' | 'hook'>,
  primarySoftmaxSpans?: Map<
    Element,
    { left: number; right: number; midY: number; center: number }
  >,
): void {
  type Prim = { left: number; right: number; midY: number; center: number };
  const primaries: Prim[] = primarySoftmaxSpans?.size
    ? [...primarySoftmaxSpans.values()]
    : [];
  if (!primaries.length) {
    for (const [el, kind] of beamClass) {
      if (kind !== 'primary') continue;
      const path = el.querySelector('path');
      const d = path?.getAttribute('d');
      if (!d) continue;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const m of d.matchAll(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) xs.push(n);
      }
      for (const m of d.matchAll(
        /[MmLl]\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g,
      )) {
        const n = parseFloat(m[1]!);
        if (Number.isFinite(n)) ys.push(n);
      }
      if (xs.length < 2) continue;
      const btx = readElementTranslateX(el as SVGGraphicsElement);
      const left = Math.min(...xs) + btx;
      const right = Math.max(...xs) + btx;
      primaries.push({
        left,
        right,
        midY: ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0,
        center: (left + right) / 2,
      });
    }
  }
  if (!primaries.length || !tips.length) return;

  const tipXs = [
    ...new Set(tips.map((t) => Math.round(t.effectiveX * 10) / 10)),
  ].sort((a, b) => a - b);

  type HookInfo = {
    path: SVGPathElement;
    el: Element;
    left: number;
    right: number;
    w: number;
    midY: number;
    attach: number;
    free: number;
    primIdx: number;
  };
  const hooks: HookInfo[] = [];

  for (const [el, kind] of beamClass) {
    if (kind !== 'hook') continue;
    if (el.closest('.vf-stavenote, .vf-staveNote')) continue;
    const path = el.querySelector('path') as SVGPathElement | null;
    const d = path?.getAttribute('d');
    if (!path || !d) continue;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const m of d.matchAll(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g)) {
      const n = parseFloat(m[1]!);
      if (Number.isFinite(n)) xs.push(n);
    }
    for (const m of d.matchAll(
      /[MmLl]\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g,
    )) {
      const n = parseFloat(m[1]!);
      if (Number.isFinite(n)) ys.push(n);
    }
    if (xs.length < 2) continue;
    const btx = readElementTranslateX(el as SVGGraphicsElement);
    const left = Math.min(...xs) + btx;
    const right = Math.max(...xs) + btx;
    const w = right - left;
    if (w < 2) continue;
    const midY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;

    let attach = left;
    let free = right;
    let bestStemD = Infinity;
    for (const t of tips) {
      const dL = Math.abs(t.effectiveX - left);
      const dR = Math.abs(t.effectiveX - right);
      if (dL < bestStemD) {
        bestStemD = dL;
        attach = left;
        free = right;
      }
      if (dR < bestStemD) {
        bestStemD = dR;
        attach = right;
        free = left;
      }
    }
    if (bestStemD > 5) continue;

    let primIdx = -1;
    let bestPrimScore = Infinity;
    for (let i = 0; i < primaries.length; i++) {
      const p = primaries[i]!;
      if (Math.abs(p.midY - midY) > 14) continue;
      const contains = attach >= p.left - 6 && attach <= p.right + 6;
      if (!contains) continue;
      const score = Math.abs(attach - p.center);
      if (score < bestPrimScore) {
        bestPrimScore = score;
        primIdx = i;
      }
    }
    if (primIdx < 0) continue;
    hooks.push({ path, el, left, right, w, midY, attach, free, primIdx });
  }

  const byPrim = new Map<number, HookInfo[]>();
  for (const h of hooks) {
    const list = byPrim.get(h.primIdx) ?? [];
    list.push(h);
    byPrim.set(h.primIdx, list);
  }

  for (const [, group] of byPrim) {
    const minHookW = Math.min(...group.map((h) => h.w));
    const maxHookW = Math.max(...group.map((h) => h.w));
    const prim = primaries[group[0]!.primIdx]!;
    const gapsInward: number[] = [];
    for (const h of group) {
      const inward = Math.sign(prim.center - h.attach) || 1;
      let nextStem: number | null = null;
      if (inward > 0) {
        for (const x of tipXs) {
          if (x > h.attach + 2) {
            nextStem = x;
            break;
          }
        }
      } else {
        for (let i = tipXs.length - 1; i >= 0; i--) {
          const x = tipXs[i]!;
          if (x < h.attach - 2) {
            nextStem = x;
            break;
          }
        }
      }
      if (nextStem != null) gapsInward.push(Math.abs(nextStem - h.attach));
    }
    const gapCap =
      gapsInward.length > 0 ? Math.min(...gapsInward.map((g) => g * 0.4)) : minHookW;
    // 단독 Softmax hook: 자유단이 이웃 줄기에 거의 닿을 때만 단축 (단순 gap×0.4는 Softmax 11.5 정상 꼬리까지 자름)
    // 자유단이 다른 tip 3px 안이면 16–8–16에서 8분까지 두 줄처럼 보이므로 단축
    const uneven = group.length >= 2 && (maxHookW > minHookW * 1.25 || maxHookW - minHookW >= 2);
    let freeNearOtherTip = false;
    for (const h of group) {
      for (const t of tips) {
        if (!stemShaftCrossesBeamY(t, h.midY)) continue;
        if (Math.abs(t.effectiveX - h.attach) <= 3) continue;
        if (Math.abs(t.effectiveX - h.free) <= 3) {
          freeNearOtherTip = true;
          break;
        }
      }
      if (freeNearOtherTip) break;
    }
    const solitaryOvershoot =
      group.length === 1 &&
      ((gapsInward.length > 0 && minHookW >= Math.min(...gapsInward) - 2.5) || freeNearOtherTip);
    if (!uneven && !solitaryOvershoot) continue;

    let targetW = uneven ? Math.min(minHookW, gapCap) : gapCap;
    if (freeNearOtherTip && gapsInward.length > 0) {
      targetW = Math.min(targetW, Math.min(...gapsInward) * 0.45);
    }
    targetW = Math.max(4, Math.min(targetW, 11));

    for (const h of group) {
      if (Math.abs(h.w - targetW) < 0.6) continue;
      if (h.w < targetW - 0.5) continue; // 짧은 쪽은 늘리지 않음(8분 침범 방지)
      const btx = readElementTranslateX(h.el as SVGGraphicsElement);
      const d = h.path.getAttribute('d');
      if (!d) continue;
      const oldLeft = h.left - btx;
      const oldRight = h.right - btx;
      const attachLocal = h.attach - btx;
      const freeDir = Math.sign(h.free - h.attach) || 1;
      const newAttach = attachLocal;
      const newFree = attachLocal + freeDir * targetW;
      const newLeft = Math.min(newAttach, newFree);
      const newRight = Math.max(newAttach, newFree);
      if (newRight - newLeft < 1) continue;
      const mapX = (x: number) => {
        const t = (x - oldLeft) / (oldRight - oldLeft);
        return newLeft + t * (newRight - newLeft);
      };
      h.path.setAttribute('d', mapSvgPathXs(d, mapX));
      if (Math.abs(btx) >= 0.01) clearStavenoteTranslateX(h.el as SVGGraphicsElement);
    }
  }
}

/**
 * 고아 stem 밑동을 짝 stavenote 음머리 pitch Y에 다시 붙인다.
 * tip 스냅이 밑동을 밀었거나 align dx 오매칭으로 머리와 어긋난 경우를 복구.
 */
function reattachOrphanStemBasesToNoteheads(
  measure: Element,
  noteById: Map<string, { el: SVGGraphicsElement }>,
): void {
  for (const stem of measure.querySelectorAll(':scope > .vf-stem, :scope > [class*="vf-stem"]')) {
    if (stem.closest('.vf-stavenote, .vf-staveNote')) continue;
    const id = stavenoteIdForOrphanStem(stem);
    if (!id) continue;
    const note = noteById.get(id);
    if (!note) continue;
    const headYs = noteheadPitchYs(note.el);
    if (!headYs.length) continue;
    const yr = stemLocalYRange(stem);
    if (!yr) continue;
    const tipUp = yr.y0;
    const tipDown = yr.y1;
    if (tipDown - tipUp < 4) continue;
    // 음머리에 더 가까운 끝이 base → 그걸로 줄기 방향 판별(화음 여러 머리 허용)
    const distUp = Math.min(...headYs.map((y) => Math.abs(y - tipUp)));
    const distDown = Math.min(...headYs.map((y) => Math.abs(y - tipDown)));
    const stemUp = distDown <= distUp;
    const pitchY = noteheadStemBaseY(note.el, stemUp);
    if (pitchY == null) continue;
    const curBase = stemUp ? tipDown : tipUp;
    if (Math.abs(curBase - pitchY) < 0.6) continue;
    if (Math.abs(curBase - pitchY) > 24) continue;
    setStemBaseY(stem, pitchY, stemUp);
  }
}

/**
 * 연주순번 layout-x 그리드 → SVG 절대 배치.
 * 순번 column 단위로만 매칭·이동. 화음은 pitches[] 전부로 매칭.
 * layout tenths는 항상 32..432 전체에 비례(voice1 관측 구간 외삽 금지 — po5가 po2에 붙는 회귀).
 */
function alignMeasureNotesByPlayOrderGrid(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
  staffIndex: number,
  targets: readonly PreviewNoteLayoutTarget[],
): void {
  const partId = partIdFromGraphic(gmRaw as any);
  const measureNumber = measureMxlFromGraphic(gmRaw as any);
  if (!partId || measureNumber == null) return;

  // 이전 pass translate를 지우고 natural x로 span·배치(반복 호출 시 origin이 왼쪽으로 붕괴하지 않음)
  for (const h of collectMeasureNoteHits(osmd, gmRaw)) clearStavenoteTranslateX(h.stavenote);
  const hits = collectMeasureNoteHits(osmd, gmRaw);
  if (!hits.length) return;

  const explicitTargets = targets.filter((t) => {
    if (t.measureNumber !== measureNumber) return false;
    if (!partIdsMatch(partId, t.partId)) return false;
    if (!targetStaffMatchesGraphic(staffWithinPartForIndex(partId, staffIndex), t.staff)) return false;
    return t.playOrder != null || (t.playOrderAlign != null && t.playOrderAlign !== '');
  });
  if (!explicitTargets.length) return;

  // 숫자 순번 column + 참조(5-6)는 대상 순번 열의 default-x를 이미 layout에서 받음
  const byColumnKey = new Map<string, PreviewNoteLayoutTarget[]>();
  for (const t of explicitTargets) {
    const colKey =
      t.playOrderAlign && t.playOrderAlign.trim()
        ? `align:${t.playOrderAlign}`
        : `po:${t.playOrder}`;
    const list = byColumnKey.get(colKey) ?? [];
    list.push(t);
    byColumnKey.set(colKey, list);
  }

  const measureSpan = playOrderPlacementSpan(osmd, gmRaw, hits, byColumnKey.size);
  if (!measureSpan) return;

  const usedHits = new Set<SVGGraphicsElement>();
  for (const colKey of [...byColumnKey.keys()].sort()) {
    const group = byColumnKey.get(colKey)!;
    const layoutX = group[0]!.defaultXTenths;
    // voice별 한 stavenote만 이동 — pitch마다 매칭하면 po2 Bb4가 tetra(B4)까지 끌어 po4가 po2 열에 붙음
    const byVoice = new Map<string, PreviewNoteLayoutTarget[]>();
    for (const t of group) {
      const list = byVoice.get(t.voice) ?? [];
      list.push(t);
      byVoice.set(t.voice, list);
    }
    for (const [voice, voiceTargets] of byVoice) {
      const pitchSet = [...new Set(voiceTargets.map((t) => t.pitch))];
      const expectHeads = pitchSet.length;
      const candidates = hits
        .filter((h) => h.voice === voice && !usedHits.has(h.stavenote))
        .filter((h) => pitchSet.some((p) => hitHasPitch(h, p)))
        .sort((a, b) => {
          // 화음 머리 수 일치 우선 — [F4,Bb4](2) vs tetra(4)
          const da = Math.abs(a.heads - expectHeads);
          const db = Math.abs(b.heads - expectHeads);
          if (da !== db) return da - db;
          // 목표 pitch를 더 많이 포함한 쪽
          const ca = pitchSet.filter((p) => hitHasPitch(a, p)).length;
          const cb = pitchSet.filter((p) => hitHasPitch(b, p)).length;
          if (cb !== ca) return cb - ca;
          const ta = a.timestamp;
          const tb = b.timestamp;
          if (ta != null && tb != null && Math.abs(ta - tb) > 1e-4) return ta - tb;
          return a.centerX - b.centerX;
        });
      if (!candidates.length) continue;
      const hit = candidates[0]!;
      // 화음인데 머리 수가 전혀 다르면(예: 2 vs 4) 스킵 — 다른 순번 화음 오매칭 방지
      if (expectHeads > 1 && Math.abs(hit.heads - expectHeads) > 0) continue;
      usedHits.add(hit.stavenote);
      alignStavenoteToTarget(hit.stavenote, layoutX, hit.centerX, measureSpan);
    }
  }
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

function alignPlayOrderGroupForce(
  items: StaveGraphic[],
  measureSpanPx: number | null = null,
): void {
  const bySvg = new Map<SVGGraphicsElement, StaveGraphic>();
  for (const item of items) {
    const prev = bySvg.get(item.svg);
    if (!prev || item.centerX < prev.centerX) bySvg.set(item.svg, item);
  }
  const unique = [...bySvg.values()];
  if (unique.length < 2) return;
  const anchorX = Math.min(...unique.map((u) => u.centerX));
  const maxNeeded = Math.max(...unique.map((u) => Math.abs(anchorX - u.centerX)));
  if (maxNeeded < 0.5) return;
  // voice2가 멀리 있어도 상한까지 당김(포기하지 않음). 상한≈마디 폭*1.5 (여러 pass로 수렴).
  const cap = Math.max(MAX_ONSET_ALIGN_SHIFT_PX, (measureSpanPx ?? 240) * 1.5);
  for (const u of unique) {
    applySvgTranslateX(u.svg, anchorX - u.centerX, cap);
  }
}

function effectivePlayOrderKey(t: PreviewNoteLayoutTarget): number | null {
  if (t.playOrderAlign) return null;
  return t.effectivePlayOrder ?? t.playOrder;
}

/**
 * partial voice — voice2만 `po=1` 등 **명시 순번**이 있고 voice1은 timeline 기본 순번인 column.
 * XML layout-x가 이미 같은 열인데 OSMD가 backup voice를 오른쪽에 그릴 때만,
 * `5-6` 참조와 동일하게 **명시 순번 voice의 stavenote만** 앵커(voice 번호 최소) x로 이동.
 * 전역 po cluster snap(alignPlayOrderGroupForce)은 빔 회귀 때문에 쓰지 않음.
 */
function alignPartialVoiceExplicitPlayOrderColumns(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
  staffIndex: number,
  targets: readonly PreviewNoteLayoutTarget[],
): void {
  const partId = partIdFromGraphic(gmRaw as any);
  const measureNumber = measureMxlFromGraphic(gmRaw as any);
  if (!partId || measureNumber == null) return;

  const measureTargets = targets.filter((t) => {
    if (t.measureNumber !== measureNumber) return false;
    if (!partIdsMatch(partId, t.partId)) return false;
    if (!targetStaffMatchesGraphic(staffWithinPartForIndex(partId, staffIndex), t.staff)) return false;
    return true;
  });
  if (!measureTargets.length) return;

  const byPo = new Map<number, PreviewNoteLayoutTarget[]>();
  for (const t of measureTargets) {
    const po = effectivePlayOrderKey(t);
    if (po == null) continue;
    const list = byPo.get(po) ?? [];
    list.push(t);
    byPo.set(po, list);
  }

  const partialGroups: Array<{ po: number; group: PreviewNoteLayoutTarget[]; anchorVoice: string }> = [];
  for (const [po, group] of byPo) {
    const voices = new Set(group.map((t) => t.voice));
    if (voices.size < 2) continue;
    const layoutXs = group.map((t) => t.defaultXTenths);
    if (Math.max(...layoutXs) - Math.min(...layoutXs) > 1) continue;
    const anchorVoice = [...voices].sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99))[0]!;
    const hasExplicitNonAnchor = group.some((t) => t.playOrder === po && t.voice !== anchorVoice);
    if (!hasExplicitNonAnchor) continue;
    partialGroups.push({ po, group, anchorVoice });
  }
  if (!partialGroups.length) return;

  const hits = collectMeasureNoteHits(osmd, gmRaw);
  if (!hits.length) return;

  const measureSpan = playOrderPlacementSpan(osmd, gmRaw, hits, Math.max(2, partialGroups.length));
  if (!measureSpan) return;

  const usedHits = new Set<SVGGraphicsElement>();
  for (const { po, group, anchorVoice } of partialGroups.sort((a, b) => a.po - b.po)) {
    const layoutX = group[0]!.defaultXTenths;
    const wantFromGrid = wantXFromLayoutGrid(measureSpan, layoutX);

    const anchorTargets = group.filter((t) => t.voice === anchorVoice);
    const anchorPitches = [...new Set(anchorTargets.map((t) => t.pitch))];
    let anchorX: number | null = null;
    if (anchorPitches.length) {
      const anchorCandidates = hits
        .filter((h) => h.voice === anchorVoice && !usedHits.has(h.stavenote))
        .filter((h) => anchorPitches.some((p) => hitHasPitch(h, p)))
        .sort(
          (a, b) =>
            Math.abs(a.centerX - wantFromGrid) - Math.abs(b.centerX - wantFromGrid) ||
            a.centerX - b.centerX,
        );
      if (anchorCandidates.length) {
        anchorX = anchorCandidates[0]!.centerX;
        usedHits.add(anchorCandidates[0]!.stavenote);
      }
    }
    const wantX = anchorX ?? wantFromGrid;

    for (const t of group) {
      if (t.voice === anchorVoice || t.playOrder !== po) continue;
      const candidates = hits
        .filter((h) => h.voice === t.voice && !usedHits.has(h.stavenote))
        .filter((h) => hitHasPitch(h, t.pitch))
        .sort(
          (a, b) =>
            Math.abs(a.centerX - wantFromGrid) - Math.abs(b.centerX - wantFromGrid) ||
            a.centerX - b.centerX,
        );
      if (!candidates.length) continue;
      const hit = candidates[0]!;
      if (Math.abs(hit.centerX - wantX) < 4) continue;
      usedHits.add(hit.stavenote);
      const dx = wantX - hit.centerX;
      const cap = Math.max(MAX_ONSET_ALIGN_SHIFT_PX, measureSpan.spanPx * 2);
      applySvgTranslateX(hit.stavenote, dx, cap);
    }
  }
}

function measureHasPartialVoicePlayOrder(targets: readonly PreviewNoteLayoutTarget[]): boolean {
  const byPo = new Map<number, PreviewNoteLayoutTarget[]>();
  for (const t of targets) {
    const po = effectivePlayOrderKey(t);
    if (po == null) continue;
    const list = byPo.get(po) ?? [];
    list.push(t);
    byPo.set(po, list);
  }
  for (const [po, group] of byPo) {
    const voices = new Set(group.map((t) => t.voice));
    if (voices.size < 2) continue;
    const layoutXs = group.map((t) => t.defaultXTenths);
    if (Math.max(...layoutXs) - Math.min(...layoutXs) > 1) continue;
    const anchorVoice = [...voices].sort((a, b) => (parseInt(a, 10) || 99) - (parseInt(b, 10) || 99))[0]!;
    if (group.some((t) => t.playOrder === po && t.voice !== anchorVoice)) return true;
  }
  return false;
}

/**
 * 명시 연주순번 — 같은 playOrder끼리 상대 snap(다성부 column).
 * @deprecated 전역 호출 금지 — 빔 회귀. partial voice는 alignPartialVoiceExplicitPlayOrderColumns 사용.
 */
function alignExplicitPlayOrderColumnsRelative(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
  staffIndex: number,
  targets: readonly PreviewNoteLayoutTarget[],
): void {
  const partId = partIdFromGraphic(gmRaw as any);
  const measureNumber = measureMxlFromGraphic(gmRaw as any);
  if (!partId || measureNumber == null) return;

  const hits = collectMeasureNoteHits(osmd, gmRaw);
  if (!hits.length) return;

  const measureSpanPx = measureSpanFromHits(hits)?.spanPx ?? null;

  const byPo = new Map<number, PreviewNoteLayoutTarget[]>();
  for (const t of targets) {
    if (t.measureNumber !== measureNumber) continue;
    if (!partIdsMatch(partId, t.partId)) continue;
    if (!targetStaffMatchesGraphic(staffWithinPartForIndex(partId, staffIndex), t.staff)) continue;
    const po = effectivePlayOrderKey(t);
    if (po == null) continue;
    const list = byPo.get(po) ?? [];
    list.push(t);
    byPo.set(po, list);
  }

  // 순번 오름차순 — 왼쪽 column부터 소비(중복 pitch 매칭)
  const sortedPos = [...byPo.keys()].sort((a, b) => a - b);
  const usedAcrossColumns = new Set<SVGGraphicsElement>();

  for (const po of sortedPos) {
    const allForPo = byPo.get(po) ?? [];
    // voice별 layout-x가 둘 이상이면 그 voice는 snap 제외(같은 po·다른 onset 잔여)
    const byVoice = new Map<string, PreviewNoteLayoutTarget[]>();
    for (const t of allForPo) {
      const list = byVoice.get(t.voice) ?? [];
      list.push(t);
      byVoice.set(t.voice, list);
    }
    const queue: PreviewNoteLayoutTarget[] = [];
    let snapVoiceCount = 0;
    for (const [, list] of byVoice) {
      const xs = new Set(list.map((t) => t.defaultXTenths.toFixed(1)));
      if (xs.size > 1) continue;
      queue.push(...list);
      snapVoiceCount += 1;
    }
    if (snapVoiceCount < 2 || queue.length < 2) continue;

    const hasExplicitPo = queue.some((t) => t.playOrder != null);
    const layoutXs = queue.map((t) => t.defaultXTenths);
    const layoutSpread = Math.max(...layoutXs) - Math.min(...layoutXs);
    // XML layout이 이미 같은 열이거나, 한 voice 이상이 명시 순번을 가질 때만 snap
    if (!hasExplicitPo && layoutSpread > 1) continue;

    const byVoicePitch = new Map<string, PreviewNoteLayoutTarget[]>();
    for (const t of queue) {
      const vp = `${t.voice}|${t.pitch}`;
      const list = byVoicePitch.get(vp) ?? [];
      list.push(t);
      byVoicePitch.set(vp, list);
    }

    const cluster: StaveGraphic[] = [];
    const vpEntries = [...byVoicePitch.entries()].sort((a, b) => {
      const va = parseInt(a[0]!.split('|')[0]!, 10) || 99;
      const vb = parseInt(b[0]!.split('|')[0]!, 10) || 99;
      return va - vb;
    });

    let anchorX: number | null = null;
    let anchorTs: number | null = null;
    for (const [vp] of vpEntries) {
      const voice = vp.split('|')[0]!;
      const expectedHeads = new Set(queue.filter((t) => t.voice === voice).map((t) => t.pitch)).size;
      const candidates = hits
        .filter((h) => h.voice === vp.split('|')[0] && hitHasPitch(h, vp.split('|')[1]!) && !usedAcrossColumns.has(h.stavenote))
        .sort((a, b) => {
          // 1) 화음 머리 수 — po2 [F4,Bb4](2) vs po4 4화음 오매칭 방지
          if (expectedHeads > 1) {
            const da = Math.abs(a.heads - expectedHeads);
            const db = Math.abs(b.heads - expectedHeads);
            if (da !== db) return da - db;
          }
          // 2) anchor(보통 voice1)와 같은 musical time
          if (anchorTs != null && a.timestamp != null && b.timestamp != null) {
            const da = Math.abs(a.timestamp - anchorTs);
            const db = Math.abs(b.timestamp - anchorTs);
            if (Math.abs(da - db) > 1e-4) return da - db;
          }
          const ta = a.timestamp;
          const tb = b.timestamp;
          if (ta != null && tb != null && Math.abs(ta - tb) > 1e-4) return ta - tb;
          // 3) anchor x에 가까운 쪽보다 — 멀어도 “아직 안 쓴” 것 중 timestamp/문서순
          return a.centerX - b.centerX;
        });
      if (!candidates.length) continue;
      const chosen = candidates[0]!;
      usedAcrossColumns.add(chosen.stavenote);
      cluster.push({ svg: chosen.stavenote, centerX: chosen.centerX });
      if (anchorX == null) anchorX = chosen.centerX;
      if (anchorTs == null && chosen.timestamp != null) anchorTs = chosen.timestamp;
    }
    if (cluster.length >= 2) alignPlayOrderGroupForce(cluster, measureSpanPx);
  }
}

function collectGraphicsByPitches(
  osmd: OpenSheetMusicDisplay,
  partId: string,
  measureNumber: number,
  pitches: ReadonlySet<string>,
  targetTimestamp?: number | null,
  timestampTolerance = 0.02,
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
        const gveTs = osmdTimestampFromGraphicVoiceEntry(gve);
        if (targetTimestamp != null) {
          if (gveTs == null || Math.abs(gveTs - targetTimestamp) > timestampTolerance) continue;
        }
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

function collectLinkedParallelGraphics(
  osmd: OpenSheetMusicDisplay,
  hint: LinkedParallelOnsetHint,
): StaveGraphic[] {
  const pitchSet = new Set(hint.memberPitches);
  const all = collectGraphicsByPitches(osmd, hint.partId, hint.measureNumber, pitchSet);
  if (all.length < 2) return all;

  const anchorPitch = hint.anchorPitch;
  const anchorTsFromHint = osmdTimestampFromLinkedParallelHint(hint);
  let anchorTs: number | null = null;

  forEachGraphicalMeasure(osmd, (gmRaw) => {
    if (anchorTs != null) return;
    if (measureMxlFromGraphic(gmRaw) !== hint.measureNumber) return;
    const graphicPartId = partIdFromGraphic(gmRaw);
    if (!graphicPartId || !partIdsMatch(graphicPartId, hint.partId)) return;
    for (const seRaw of ((asRecord(gmRaw)?.staffEntries ?? asRecord(gmRaw)?.StaffEntries) as unknown[]) ?? []) {
      const se = asRecord(seRaw);
      if (!se) continue;
      for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          if (!gn || pitchFromGraphicNote(gn) !== anchorPitch) continue;
          const ts = osmdTimestampFromGraphicVoiceEntry(gve);
          if (ts != null) anchorTs = ts;
        }
      }
    }
  });

  const targetTs = anchorTs ?? anchorTsFromHint;
  const tolerance = 0.02;
  const filtered: StaveGraphic[] = [];
  const seenSvg = new Set<SVGGraphicsElement>();
  forEachGraphicalMeasure(osmd, (gmRaw) => {
    if (measureMxlFromGraphic(gmRaw) !== hint.measureNumber) return;
    const graphicPartId = partIdFromGraphic(gmRaw);
    if (!graphicPartId || !partIdsMatch(graphicPartId, hint.partId)) return;
    for (const seRaw of ((asRecord(gmRaw)?.staffEntries ?? asRecord(gmRaw)?.StaffEntries) as unknown[]) ?? []) {
      const se = asRecord(seRaw);
      if (!se) continue;
      for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        const gveTs = osmdTimestampFromGraphicVoiceEntry(gve);
        if (gveTs == null || Math.abs(gveTs - targetTs) > tolerance) continue;
        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          if (!gn) continue;
          const pitch = pitchFromGraphicNote(gn);
          if (!pitch || !pitchSet.has(pitch)) continue;
          const voice = voiceFromGraphicNote(gn);
          if (voice && hint.memberVoices.length && !hint.memberVoices.includes(voice)) continue;
          const stavenote = graphicNoteStavenote(osmd, gn);
          if (!stavenote || seenSvg.has(stavenote)) continue;
          const centerX = noteheadCenterXInSvgRoot(stavenote);
          if (centerX == null || !Number.isFinite(centerX)) continue;
          seenSvg.add(stavenote);
          filtered.push({ svg: stavenote, centerX });
        }
      }
    }
  });
  return filtered.length >= 2 ? filtered : [];
}

function alignLinkedParallelHintGroups(
  osmd: OpenSheetMusicDisplay,
  hints: readonly LinkedParallelOnsetHint[],
): void {
  for (const hint of hints) {
    if (hint.memberPitches.length < 2) continue;
    const graphics = collectLinkedParallelGraphics(osmd, hint);
    if (graphics.length >= 2) alignPlayOrderGroupForce(graphics);
  }
}

/**
 * `1-6` 등 참조의 앵커 SVG hit.
 * 같은 voice에 동일 pitch가 여러 열(예: A4 순번5·16분 vs 순번6·4분)이면
 * pitch+layout 근접만으로는 5번째를 고르기 쉬움 → voice 열을 timestamp/default-x로 짝지은 뒤 순번 매칭.
 */
export function resolvePlayOrderRefAnchorHit(
  hits: readonly NoteHit[],
  measureTargets: readonly PreviewNoteLayoutTarget[],
  anchorVoice: string,
  anchorOrder: number,
  usedHits?: ReadonlySet<SVGGraphicsElement>,
  measureSpan?: { originX: number; spanPx: number } | null,
): NoteHit | null {
  const used = usedHits ?? new Set<SVGGraphicsElement>();
  const byOrder = new Map<number, PreviewNoteLayoutTarget[]>();
  for (const t of measureTargets) {
    if (t.voice !== anchorVoice || t.playOrderAlign) continue;
    const po = t.effectivePlayOrder ?? t.playOrder;
    if (po == null) continue;
    const list = byOrder.get(po) ?? [];
    list.push(t);
    byOrder.set(po, list);
  }
  const columnTargets = [...byOrder.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([po, list]) => {
      const lead = [...list].sort((a, b) => a.defaultXTenths - b.defaultXTenths)[0]!;
      return { ...lead, effectivePlayOrder: po, playOrder: lead.playOrder ?? po };
    });
  const anchors = byOrder.get(anchorOrder) ?? [];
  if (!columnTargets.length || !anchors.length) return null;

  const voiceHits = hits
    .filter((h) => h.voice === anchorVoice && !used.has(h.stavenote))
    .sort((a, b) => {
      const ta = a.timestamp;
      const tb = b.timestamp;
      if (ta != null && tb != null && Math.abs(ta - tb) > 1e-6) return ta - tb;
      return a.centerX - b.centerX;
    });

  if (voiceHits.length > 0 && columnTargets.length > 0) {
    const n = Math.min(voiceHits.length, columnTargets.length);
    const pairs = pairHitsWithLayoutTargetsByBestMatch(voiceHits.slice(0, n), columnTargets.slice(0, n));
    const matched = pairs.find(
      (p) => (p.target.effectivePlayOrder ?? p.target.playOrder) === anchorOrder,
    );
    if (matched) return matched.hit;
  }

  // fallback: pitch + (가능하면) 머리 수 + layout 근접 — 동일 pitch 다열일 때 최후 수단
  const anchorPitches = [...new Set(anchors.map((a) => a.pitch))];
  const expectHeads = new Set(anchors.map((a) => a.pitch)).size;
  const layoutAnchor = anchors[0]!.defaultXTenths;
  const wantApprox =
    measureSpan != null ? wantXFromLayoutGrid(measureSpan, layoutAnchor) : layoutAnchor;
  const candidates = hits
    .filter((h) => !used.has(h.stavenote))
    .filter((h) => anchorPitches.some((p) => hitHasPitch(h, p)))
    .sort((a, b) => {
      const va = a.voice === anchorVoice ? 0 : 1;
      const vb = b.voice === anchorVoice ? 0 : 1;
      if (va !== vb) return va - vb;
      if (expectHeads > 1) {
        const da = Math.abs(a.heads - expectHeads);
        const db = Math.abs(b.heads - expectHeads);
        if (da !== db) return da - db;
      }
      return Math.abs(a.centerX - wantApprox) - Math.abs(b.centerX - wantApprox);
    });
  return candidates[0] ?? null;
}

/**
 * `5-6` 참조 — voice5 순번6 음표 SVG x에 맞춤.
 * layout tenths만으로는 OSMD가 backup voice를 마디 앞에 남겨 순번1과 포개질 수 있음.
 */
function alignPlayOrderAlignRefsToAnchorVoice(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
  staffIndex: number,
  targets: readonly PreviewNoteLayoutTarget[],
): void {
  const partId = partIdFromGraphic(gmRaw as any);
  const measureNumber = measureMxlFromGraphic(gmRaw as any);
  if (!partId || measureNumber == null) return;

  const measureTargets = targets.filter((t) => {
    if (t.measureNumber !== measureNumber) return false;
    if (!partIdsMatch(partId, t.partId)) return false;
    if (!targetStaffMatchesGraphic(staffWithinPartForIndex(partId, staffIndex), t.staff)) return false;
    return true;
  });
  const alignTargets = measureTargets.filter((t) => t.playOrderAlign != null && t.playOrderAlign !== '');
  if (!alignTargets.length) return;

  for (const h of collectMeasureNoteHits(osmd, gmRaw)) clearStavenoteTranslateX(h.stavenote);
  const hits = collectMeasureNoteHits(osmd, gmRaw);
  if (!hits.length) return;
  const distinctCols = new Set(
    measureTargets.map((t) => t.playOrderAlign ?? (t.playOrder != null ? String(t.playOrder) : '')).filter(Boolean),
  );
  const measureSpan = playOrderPlacementSpan(osmd, gmRaw, hits, Math.max(2, distinctCols.size));
  if (!measureSpan) return;

  const usedHits = new Set<SVGGraphicsElement>();
  const groups = new Map<string, PreviewNoteLayoutTarget[]>();
  for (const t of alignTargets) {
    const key = `${t.voice}|${t.playOrderAlign}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  for (const [, group] of groups) {
    const alignSpec = parsePlayOrderSpec(group[0]!.playOrderAlign ?? '');
    if (!alignSpec || alignSpec.kind !== 'ref') continue;
    const anchorVoice = String(alignSpec.voice);
    const anchorOrder = alignSpec.order;

    const anchors = measureTargets.filter(
      (t) =>
        t.voice === anchorVoice &&
        (t.effectivePlayOrder ?? t.playOrder) === anchorOrder &&
        !t.playOrderAlign,
    );
    const anchorHit = resolvePlayOrderRefAnchorHit(
      hits,
      measureTargets,
      anchorVoice,
      anchorOrder,
      usedHits,
      measureSpan,
    );
    const anchorX = anchorHit?.centerX ?? null;

    const layoutX = anchors[0]?.defaultXTenths ?? group[0]!.defaultXTenths;
    const wantX = anchorX != null ? anchorX : wantXFromLayoutGrid(measureSpan, layoutX);

    const byVoice = new Map<string, PreviewNoteLayoutTarget[]>();
    for (const t of group) {
      const list = byVoice.get(t.voice) ?? [];
      list.push(t);
      byVoice.set(t.voice, list);
    }
    for (const [voice, voiceTargets] of byVoice) {
      const pitchSet = [...new Set(voiceTargets.map((t) => t.pitch))];
      const expectHeads = pitchSet.length;
      const candidates = hits
        .filter((h) => !usedHits.has(h.stavenote))
        .filter((h) => pitchSet.some((p) => hitHasPitch(h, p)))
        .sort((a, b) => {
          const va = a.voice === voice ? 0 : 1;
          const vb = b.voice === voice ? 0 : 1;
          if (va !== vb) return va - vb;
          const da = Math.abs(a.heads - expectHeads);
          const db = Math.abs(b.heads - expectHeads);
          if (da !== db) return da - db;
          return a.centerX - b.centerX;
        });
      if (!candidates.length) continue;
      const hit = candidates[0]!;
      if (expectHeads > 1 && Math.abs(hit.heads - expectHeads) > 0) continue;
      usedHits.add(hit.stavenote);
      const dx = wantX - hit.centerX;
      const cap = Math.max(MAX_ONSET_ALIGN_SHIFT_PX, measureSpan.spanPx * 2);
      applySvgTranslateX(hit.stavenote, dx, cap);
    }
  }
}

/**
 * Softmax notehead 구간 안에서 layout-x(duration) 비례 재배치.
 * **실제 쓰인** layout-x 구간만 [minHit, 마디끝−여백]에 매핑(32..432 전체 우겨넣기 금지 —
type OnsetColumn = { layoutX: number; pitchSet: string[]; expectHeads: number };

/**
 * 음표를 onset column에 단조(monotonic) 매칭한다.
 * 1) column 수와 rendered stavenote 수가 같을 때: 1:1 순차 매칭 (시간 순서 100% 보존).
 * 2) 다를 때: DP(동적 계획법)를 통해 i < k => j < l 단조 증가 순서를 엄격히 강제.
 * 어떤 경우에도 뒤쪽 음표가 앞쪽 음표를 가로지르거나(reverse crossing),
 * 빔에서 떨어져 나와 다른 빔과 겹치는 현상을 원천 방지한다.
 */
function matchVoiceHitsToColumnsMonotonically(
  voiceHits: readonly NoteHit[],
  columns: readonly OnsetColumn[],
): Array<{ hit: NoteHit; col: OnsetColumn }> {
  const m = columns.length;
  const n = voiceHits.length;
  if (!m || !n) return [];

  if (m === n) {
    let matchCount = 0;
    for (let i = 0; i < n; i++) {
      const col = columns[i]!;
      const hit = voiceHits[i]!;
      if (
        col.pitchSet.some((p) => hitHasPitch(hit, p)) ||
        (col.pitchSet.includes('REST') &&
          (hit.pitch === 'REST' || hit.pitches.includes('REST')))
      ) {
        matchCount++;
      }
    }
    if (matchCount > 0 || n <= 2) {
      return columns.map((col, i) => ({ hit: voiceHits[i]!, col }));
    }
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(-Infinity));
  const parent: Array<Array<[number, number] | null>> = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(null),
  );

  dp[0]![0] = 0;
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= n; j++) {
      const cur = dp[i]![j]!;
      if (cur === -Infinity) continue;

      if (i < m && cur > dp[i + 1]![j]!) {
        dp[i + 1]![j] = cur;
        parent[i + 1]![j] = [i, j];
      }
      if (j < n && cur > dp[i]![j + 1]!) {
        dp[i]![j + 1] = cur;
        parent[i]![j + 1] = [i, j];
      }
      if (i < m && j < n) {
        const col = columns[i]!;
        const hit = voiceHits[j]!;
        let score = 0;
        const pitchMatch =
          col.pitchSet.some((p) => hitHasPitch(hit, p)) ||
          (col.pitchSet.includes('REST') &&
            (hit.pitch === 'REST' || hit.pitches.includes('REST')));
        if (pitchMatch) {
          score += 100;
          if (col.expectHeads > 0 && Math.abs(hit.heads - col.expectHeads) === 0) {
            score += 20;
          }
        } else {
          score -= 50;
        }
        if (cur + score > dp[i + 1]![j + 1]!) {
          dp[i + 1]![j + 1] = cur + score;
          parent[i + 1]![j + 1] = [i, j];
        }
      }
    }
  }

  let ci = m;
  let cj = n;
  const pairs: Array<{ hit: NoteHit; col: OnsetColumn }> = [];
  while (ci > 0 && cj > 0) {
    const p = parent[ci]![cj];
    if (!p) break;
    const [pi, pj] = p;
    if (pi === ci - 1 && pj === cj - 1) {
      const col = columns[pi]!;
      const hit = voiceHits[pj]!;
      const pitchMatch =
        col.pitchSet.some((pitch) => hitHasPitch(hit, pitch)) ||
        (col.pitchSet.includes('REST') &&
          (hit.pitch === 'REST' || hit.pitches.includes('REST')));
      if (pitchMatch) {
        pairs.push({ hit, col });
      }
    }
    ci = pi;
    cj = pj;
  }
  pairs.reverse();
  return pairs;
}

/**
 * Softmax notehead 구간 안에서 layout-x(duration) 비례 재배치.
 * **실제 쓰인** layout-x 구간만 notehead [min,max]에 매핑(32..432 전체 우겨넣기 금지 —
 * 앞쪽 밀집·떡·빔 붕괴 원인). Softmax max만 쓰면 마지막 음이 마디선에 포개짐.
 * 마디 g·바로는 건드리지 않음. syncVf가 빔·hook 맞춤.
 */
function alignMeasureNotesByOnsetLayoutGrid(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
  staffIndex: number,
  targets: readonly PreviewNoteLayoutTarget[],
  contentRightPx?: number | null,
): boolean {
  const partId = partIdFromGraphic(gmRaw as never);
  const measureNumber = measureMxlFromGraphic(gmRaw as never);
  if (!partId || measureNumber == null) return false;

  for (const h of collectMeasureNoteHits(osmd, gmRaw)) clearStavenoteTranslateX(h.stavenote);
  const hits0 = collectMeasureNoteHits(osmd, gmRaw);
  const measureG0 = hits0[0]?.stavenote.closest('.vf-measure');
  if (measureG0) clearMeasureEngravingTranslates(measureG0);
  const hits = collectMeasureNoteHits(osmd, gmRaw);
  if (hits.length < 2) return false;

  const partMeasureTargets = targets.filter((t) => {
    if (t.measureNumber !== measureNumber) return false;
    if (!partIdsMatch(partId, t.partId)) return false;
    return Number.isFinite(t.defaultXTenths);
  });
  if (!partMeasureTargets.length) return false;

  const withinPart = staffWithinPartForIndex(partId, staffIndex);
  const soleStaffExtract = new Set(partMeasureTargets.map((t) => t.staff)).size === 1;
  const measureTargets = partMeasureTargets.filter((t) => {
    if (targetStaffMatchesGraphic(withinPart, t.staff)) return true;
    // PR/PL split 후 XML staff가 1로 정규화된 경우
    if (soleStaffExtract) return true;
    return false;
  });
  if (!measureTargets.length) return false;

  const layoutXs = measureTargets.map((t) => t.defaultXTenths);
  const measureSpan = contentSpanFromGraphicMeasure(
    osmd,
    gmRaw,
    hits,
    layoutXs,
    contentRightPx,
  );
  if (!measureSpan) return false;

  type Place = { stavenote: SVGGraphicsElement; centerX: number; layoutX: number };
  let moved = false;

  for (const voice of [...new Set(measureTargets.map((t) => t.voice))]) {
    const voiceTargets = measureTargets.filter((t) => t.voice === voice);
    const colMap = new Map<string, OnsetColumn>();
    for (const t of voiceTargets) {
      const key = t.defaultXTenths.toFixed(2);
      const col = colMap.get(key);
      if (!col) {
        colMap.set(key, {
          layoutX: t.defaultXTenths,
          pitchSet: [t.pitch],
          expectHeads: t.pitch === 'REST' ? 0 : 1,
        });
      } else if (!col.pitchSet.includes(t.pitch)) {
        col.pitchSet.push(t.pitch);
        if (t.pitch !== 'REST') col.expectHeads += 1;
      }
    }
    const columns = [...colMap.values()].sort((a, b) => a.layoutX - b.layoutX);
    if (!columns.length) continue;

    const voiceHits = hits
      .filter((h) => h.voice === voice)
      .sort((a, b) => {
        if (a.timestamp != null && b.timestamp != null && Math.abs(a.timestamp - b.timestamp) > 1e-4) {
          return a.timestamp - b.timestamp;
        }
        return a.centerX - b.centerX;
      });
    if (!voiceHits.length) continue;

    const pairs = matchVoiceHitsToColumnsMonotonically(voiceHits, columns);
    if (pairs.length < 2) continue;

    const voicePlan: Place[] = pairs.map(({ hit, col }) => ({
      stavenote: hit.stavenote,
      centerX: hit.centerX,
      layoutX: col.layoutX,
    }));

    const ordered = [...voicePlan].sort((a, b) => a.layoutX - b.layoutX || a.centerX - b.centerX);
    let prevWant = -Infinity;
    for (const p of ordered) {
      let want = wantXFromLayoutGrid(measureSpan, p.layoutX);
      if (want < prevWant + 0.5) want = prevWant + 0.5;
      const dx = want - p.centerX;
      if (Math.abs(dx) > 0.5) moved = true;
      applySvgTranslateX(
        p.stavenote,
        dx,
        Math.max(MAX_ONSET_ALIGN_SHIFT_PX, measureSpan.spanPx * 2),
      );
      prevWant = want;
    }
  }
  return moved;
}

/** 조표·박자(beginInstructions) 왼쪽으로 침범한 음표만 평행 이동 — Softmax 상대 간격 유지. */
function pushNotesOutOfBeginInstructions(osmd: OpenSheetMusicDisplay): boolean {
  let moved = false;
  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const hits = collectMeasureNoteHits(osmd, gmRaw);
    if (!hits.length) return;
    const floor = resolveContentLeftPx(osmd, gmRaw);
    if (floor == null) return;
    const headPad = Math.max(2, osmdSvgScale(osmd) * 0.35);
    const limit = floor + headPad;
    let minX = Infinity;
    for (const h of hits) minX = Math.min(minX, h.centerX);
    if (!(minX < limit - 0.5)) return;
    const dx = limit - minX;
    for (const h of hits) {
      applySvgTranslateX(h.stavenote, dx, MAX_ONSET_ALIGN_SHIFT_PX * 2);
      moved = true;
    }
    // 짧은 hook·이음줄은 sync reshape를 건너뛰므로 여기서 같이 평행 이동
    // (안 옮기면 온쉼표/빔 파편처럼 남음)
    const measureG =
      hits[0]!.stavenote.closest('.vf-measure') ??
      hits[0]!.stavenote.parentElement;
    if (measureG) {
      for (const el of measureG.querySelectorAll(
        ':scope > .vf-beam, :scope > .vf-stavetie, :scope > [class*="vf-beam"], :scope > [class*="vf-tie"]',
      )) {
        applySvgTranslateX(el as SVGGraphicsElement, dx, MAX_ONSET_ALIGN_SHIFT_PX * 2);
      }
      for (const el of measureG.querySelectorAll(
        ':scope > .vf-stem, :scope > [class*="vf-stem"], :scope > .vf-ledgers, :scope > [class*="vf-ledgers"]',
      )) {
        if (el.closest('.vf-stavenote, .vf-staveNote')) continue;
        applySvgTranslateX(el as SVGGraphicsElement, dx, MAX_ONSET_ALIGN_SHIFT_PX * 2);
      }
    }
  });
  return moved;
}

export function alignOsmdPreviewNotesByOnsetColumn(
  osmd: OpenSheetMusicDisplay,
  previewXml?: string | null,
): void {
  const xml = resolvePreviewXml(osmd, previewXml);
  const hints = xml ? collectLinkedParallelOnsetHintsFromXml(xml) : [];
  const targets = xml ? collectPreviewNoteLayoutTargetsFromXml(xml) : [];
  const hasAlignRef = targets.some((t) => t.playOrderAlign != null && t.playOrderAlign !== '');
  const hasPartialVoicePlayOrder = measureHasPartialVoicePlayOrder(targets);

  activeStaffWithinPartByIndex = buildStaffWithinPartByStaffIndex(osmd);
  let didAlign = false;
  try {
    // Softmax notehead 폭 안에서 duration(layout-x) 재배치.
    // 실제 사용 layout 구간만 매핑. **같은 zoom당 1회** — 2회째 remesh는 빔 붕괴,
    // zoom만 바꾸고 remesh를 안 하면 Softmax 간격·마디선 겹침이 그대로 남음.
    // 시스템 열 SVG·AbsolutePosition 재배분은 오선·마디선·clip이 깨지므로 하지 않음(101d772).
    const zoomNow =
      typeof (osmd as { zoom?: number }).zoom === 'number' &&
      Number.isFinite((osmd as { zoom?: number }).zoom) &&
      ((osmd as { zoom?: number }).zoom as number) > 0
        ? ((osmd as { zoom?: number }).zoom as number)
        : 1;
    const remeshAt = onsetRemeshDoneAtZoom.get(osmd);
    const remeshDone = remeshAt != null && Math.abs(remeshAt - zoomNow) < 1e-6;
    if (targets.length > 0 && !remeshDone) {
      let remeshed = false;
      forEachGraphicalMeasure(osmd, (gmRaw, staffIndex, measureIndex, row) => {
        const nextGm = row[measureIndex + 1] ?? null;
        const contentRight = resolveContentRightPx(osmd, gmRaw, nextGm);
        if (alignMeasureNotesByOnsetLayoutGrid(osmd, gmRaw, staffIndex, targets, contentRight)) {
          remeshed = true;
          didAlign = true;
        }
      });
      if (remeshed) onsetRemeshDoneAtZoom.set(osmd, zoomNow);
    }
    if (hints.length > 0) {
      alignLinkedParallelHintGroups(osmd, hints);
      didAlign = true;
    }
    if (hasAlignRef) {
      forEachGraphicalMeasure(osmd, (gmRaw, staffIndex) => {
        alignPlayOrderAlignRefsToAnchorVoice(osmd, gmRaw, staffIndex, targets);
      });
      didAlign = true;
    }
    if (hasPartialVoicePlayOrder) {
      forEachGraphicalMeasure(osmd, (gmRaw, staffIndex) => {
        alignPartialVoiceExplicitPlayOrderColumns(osmd, gmRaw, staffIndex, targets);
      });
      didAlign = true;
    }
    // Softmax/배치가 조표·박자 영역으로 침범할 때만 평행 시프트(빔·hook 동반)
    if (pushNotesOutOfBeginInstructions(osmd)) didAlign = true;
  } finally {
    activeStaffWithinPartByIndex = null;
  }

  // remesh가 스킵돼도 다른 시프트·이전 sync 이후 tip 이동을 hook가 따라가도록 항상 sync
  const host =
    (osmd as unknown as { container?: ParentNode | null }).container ??
    (osmd as unknown as { root?: ParentNode | null }).root ??
    null;
  if (host) syncVfStemsAndBeamsAfterStavenoteAlign(host);
}

export function osmdTimestampFromLinkedParallelHint(hint: LinkedParallelOnsetHint): number {
  const div = hint.divisions > 0 ? hint.divisions : 1;
  const len = hint.measureLength > 0 ? hint.measureLength : Math.max(1, hint.divisions);
  // div>=4(16분) 마디: OSMD 내부 분모 = XML measureLength/2. div=2 는 onset/measureLength.
  if (div >= 4 && len >= div * 4) {
    return hint.onset / Math.max(1, len / 2);
  }
  return hint.onset / Math.max(1, len);
}

export function alignLinkedParallelOnsetGraphics(
  osmd: OpenSheetMusicDisplay,
  _hints: readonly LinkedParallelOnsetHint[],
  _host?: HTMLElement | null,
): void {
  alignOsmdPreviewNotesByOnsetColumn(osmd);
}
