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
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from './osmdMeasureClick';

/** XML default-x grid (shared/musicXmlPreviewOnsetLayout PREVIEW_LAYOUT_*). */
const LAYOUT_BASE_X = 32;
const LAYOUT_SPAN = 400;

const previewXmlByOsmd = new WeakMap<OpenSheetMusicDisplay, string>();

export function registerOsmdPreviewXmlForAlign(osmd: OpenSheetMusicDisplay, xml: string): void {
  previewXmlByOsmd.set(osmd, xml);
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

function pitchFromGraphicNote(gn: Record<string, unknown>): string | null {
  const fromVf = pitchFromVfPitch(gn.vfpitch ?? gn.vfPitch);
  if (fromVf) return fromVf;

  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  if (!src) return null;

  const ht = coordNum(src.halfTone ?? src.HalfTone);
  if (ht != null) return pitchLabelFromHalfTone(ht);

  const pitch = asRecord(src.Pitch ?? src.pitch);
  if (!pitch) return null;
  const fn = coordNum(pitch.FundamentalNote ?? pitch.fundamentalNote);
  const oct = coordNum(pitch.Octave ?? pitch.octave);
  if (fn == null || oct == null || fn < 0 || fn > 6) return null;
  const accRaw = coordNum(pitch.Accidental ?? pitch.accidental);
  const acc =
    accRaw === OSMD_ACCIDENTAL_FLAT ? 'b' : accRaw === OSMD_ACCIDENTAL_SHARP ? '#' : '';
  return `${STEP_NAMES[fn] ?? 'C'}${acc}${oct}`;
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
  if (src.isRest === true || src.IsRest === true) return true;
  const restFlag = src.rest ?? src.Rest;
  if (restFlag === true) return true;
  if (asRecord(restFlag)) return true;
  return false;
}

function restCenterXInSvgRoot(stavenote: SVGGraphicsElement): number | null {
  const restEl =
    (stavenote.querySelector('.vf-rest') as SVGGraphicsElement | null) ??
    (stavenote.querySelector('[class*="rest"]') as SVGGraphicsElement | null);
  if (restEl) {
    try {
      const box = restEl.getBBox();
      if (box && Number.isFinite(box.x) && Number.isFinite(box.width)) {
        return svgUserXFromElement(restEl, box.x + box.width / 2);
      }
    } catch {
      /* getBBox can throw on detached nodes */
    }
  }
  try {
    const box = stavenote.getBBox();
    if (box && Number.isFinite(box.x) && Number.isFinite(box.width)) {
      return svgUserXFromElement(stavenote, box.x + box.width / 2);
    }
  } catch {
    /* ignore */
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
        const pitchRaw = pitchFromGraphicNote(gn);
        const rest = !pitchRaw && isRestGraphicNote(gn);
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
 */
function measureSpanFromHits(hits: readonly { centerX: number }[]): { originX: number; spanPx: number } | null {
  if (hits.length < 2) return null;
  const xs = hits.map((h) => h.centerX).filter((x) => Number.isFinite(x));
  if (xs.length < 2) return null;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (max - min < 8) return null;
  const pad = (max - min) * 0.08;
  return { originX: min - pad, spanPx: max - min + pad * 2 };
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

/**
 * 모든 notehead span을 쓰되, 박자·순번 수에 맞춰 최소 폭으로 **오른쪽** 확장.
 * layout tenths 32..432를 이 폭에 비례 배치하므로 4분(onset+2) 간격이 8분(+1)의 약 2배.
 * (왼쪽 origin은 po1 근처 유지 — 이전 마디로 날아가지 않음)
 */
function playOrderPlacementSpan(
  hits: readonly NoteHit[],
  distinctPlayOrders: number,
): { originX: number; spanPx: number } | null {
  const natural = measureSpanFromHits(hits);
  if (!natural) return null;
  const cols = Math.max(1, distinctPlayOrders);
  // 4/4 한 마디 ≈ 4박 — 박당 MIN_PX_PER_QUARTER 확보 시 4분 간격이 시각적으로 분리됨
  const minByBeat = 4 * MIN_PX_PER_QUARTER;
  const minByCols = (cols - 1) * MIN_PLAY_ORDER_COLUMN_PX;
  const minSpan = Math.max(natural.spanPx, minByBeat, minByCols);
  if (minSpan <= natural.spanPx + 0.5) return natural;
  return { originX: natural.originX, spanPx: minSpan };
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

/** XML `<staff>` vs OSMD staffIndex+1. PL/PR split 추출 시 XML은 `<staff>2</staff>` 유지, OSMD는 sole staffIndex 0. REGRESSION: test_partial_voice_regression.ts */
function targetStaffMatchesGraphic(staffIndex: number, targetStaff: number): boolean {
  const graphicStaff = staffIndex + 1;
  if (targetStaff === graphicStaff) return true;
  if (graphicStaff === 1 && targetStaff > 1) return true;
  if (targetStaff === 1) return true;
  return false;
}

function clearStavenoteTranslateX(svg: SVGGraphicsElement): void {
  const tr = svg.getAttribute('transform') ?? '';
  if (!/translate\s*\(/.test(tr)) return;
  const rest = tr.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
  if (rest) svg.setAttribute('transform', rest);
  else svg.removeAttribute('transform');
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
    // natural: stavenote dx만 제거(빔·sibling stem은 contain 전 좌표에 맞춤)
    const naturalX = localX + (totalTx - snDx);
    const effectiveX = localX + totalTx;
    tips.push({
      el: stem,
      naturalX,
      effectiveX,
      dx: snDx || readElementTranslateX(stem),
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

function noteheadPitchY(stavenote: Element): number | null {
  const hd = stavenote.querySelector('.vf-notehead path')?.getAttribute('d');
  if (!hd) return null;
  const first = /M\s*[-\d.eE+]+\s+([-\d.eE+]+)/i.exec(hd);
  if (!first) return null;
  const y = parseFloat(first[1]!);
  return Number.isFinite(y) ? y : null;
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
    let best: NoteShift | null = null;
    let bestScore = Infinity;
    for (const n of notes) {
      if (n.hasInnerStem) continue;
      const dX = Math.abs(n.naturalX - x);
      if (dX > 40) continue;
      const pitch = noteheadPitchY(n.el);
      const dY = pitch != null ? Math.abs(pitch - stemBaseY) : 20;
      const score = dX + dY * 0.35;
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

  // stem tip 재수집(형제 stem translate 반영)
  const tipsAfter = collectStemTipsInMeasure(measure);

  const reshapeByStemTips = (el: Element, pad = 20): void => {
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
      const beamY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;

      // 빔 span 안 줄기. y 대역으로 다른 보표·다른 방향(같은 x의 v6 등) 줄기 제외.
      let matched = tipsAfter.filter(
        (t) =>
          t.naturalX >= oldLeft - 4 &&
          t.naturalX <= oldRight + 8 &&
          (ys.length === 0 || stemShaftCrossesBeamY(t, beamY)),
      );

      // 빔 왼쪽 끝이 어떤 줄기 tip에도 안 닿을 때만 orphan 편입.
      // (grand staff PL: 같은 onset의 stem-down v6가 4~14px 왼쪽에 있어도 y가 안 맞으면 제외 —
      //  예: m4 D3 빔이 D2 줄기로 빨려 깨지던 회귀)
      const stemAtBeamStart = matched.some((t) => Math.abs(t.naturalX - oldLeft) <= 4);
      if (!stemAtBeamStart && matched.length >= 1) {
        const orphans = tipsAfter.filter((t) => {
          if (ys.length && !stemShaftCrossesBeamY(t, beamY)) return false;
          const gap = oldLeft - t.naturalX;
          return gap > 4 && gap <= 14;
        });
        if (orphans.length) matched = [...orphans, ...matched];
      }

      // 다른 voice 줄기가 span 앞에만 걸치면(거의 빔 밖) 제외 — 왼쪽 여유 4px만
      if (matched.length < 2) {
        const yOk = (t: StemTip) => ys.length === 0 || stemShaftCrossesBeamY(t, beamY);
        const byLeft = tipsAfter
          .filter(yOk)
          .slice()
          .sort((a, b) => Math.abs(a.naturalX - oldLeft) - Math.abs(b.naturalX - oldLeft));
        const leftTip = byLeft[0];
        const byRight = tipsAfter
          .filter(yOk)
          .slice()
          .sort((a, b) => Math.abs(a.naturalX - oldRight) - Math.abs(b.naturalX - oldRight));
        const rightTip = byRight.find((t) => t !== leftTip) ?? byRight[0];
        if (
          leftTip &&
          rightTip &&
          leftTip !== rightTip &&
          Math.abs(leftTip.naturalX - oldLeft) <= pad &&
          Math.abs(rightTip.naturalX - oldRight) <= pad
        ) {
          matched = [leftTip, rightTip];
        }
      }
      if (matched.length < 2) continue;

      const newLeft = Math.min(...matched.map((t) => t.effectiveX));
      const newRight = Math.max(...matched.map((t) => t.effectiveX));
      if (newRight - newLeft < 1) continue;
      if (Math.abs(newLeft - oldLeft) < 1.2 && Math.abs(newRight - oldRight) < 1.2) continue;

      const mapX = (x: number) => {
        const t = (x - oldLeft) / (oldRight - oldLeft);
        return newLeft + t * (newRight - newLeft);
      };
      path.setAttribute('d', mapSvgPathXs(d, mapX));
    }
  };

  for (const beam of measure.querySelectorAll(':scope > .vf-beam, :scope > [class*="vf-beam"]')) {
    reshapeByStemTips(beam);
  }
  // 빔 X 맞춤 후, 멤버 줄기 tip이 빔선에 닿도록 y를 연장(끊겨 4분처럼 보이는 증상).
  snapStemTipsToBeamsInMeasure(measure, tipsAfter);
  // tip 스냅/오매칭으로 밑동이 음머리에서 떨어진 고아 줄기 재부착
  reattachOrphanStemBasesToNoteheads(measure, noteById);
  for (const tie of measure.querySelectorAll(':scope > .vf-stavetie, :scope > [class*="vf-tie"]')) {
    reshapeByStemTips(tie, 48);
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
    const pitchY = noteheadPitchY(note.el);
    if (pitchY == null) continue;
    const yr = stemLocalYRange(stem);
    if (!yr) continue;
    const tipUp = yr.y0;
    const tipDown = yr.y1;
    if (tipDown - tipUp < 4) continue;
    // pitch에 더 가까운 끝이 base. stem-up이면 base = max y.
    const stemUp = Math.abs(tipDown - pitchY) <= Math.abs(tipUp - pitchY);
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
    if (!targetStaffMatchesGraphic(staffIndex, t.staff)) return false;
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

  const measureSpan = playOrderPlacementSpan(hits, byColumnKey.size);
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
    if (!targetStaffMatchesGraphic(staffIndex, t.staff)) return false;
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

  const measureSpan = playOrderPlacementSpan(hits, Math.max(2, partialGroups.length));
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
    if (!targetStaffMatchesGraphic(staffIndex, t.staff)) continue;
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
    if (!targetStaffMatchesGraphic(staffIndex, t.staff)) return false;
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
  const measureSpan = playOrderPlacementSpan(hits, Math.max(2, distinctCols.size));
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

export function alignOsmdPreviewNotesByOnsetColumn(
  osmd: OpenSheetMusicDisplay,
  previewXml?: string | null,
): void {
  const xml = resolvePreviewXml(osmd, previewXml);
  const hints = xml ? collectLinkedParallelOnsetHintsFromXml(xml) : [];
  const targets = xml ? collectPreviewNoteLayoutTargetsFromXml(xml) : [];
  const hasAlignRef = targets.some((t) => t.playOrderAlign != null && t.playOrderAlign !== '');
  const hasPartialVoicePlayOrder = measureHasPartialVoicePlayOrder(targets);

  // linkParallel + voice-순번 참조(5-6) + partial voice(명시 po + timeline 앵커 voice)만 SVG 보정.
  let didAlign = false;
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
  if (didAlign) {
    const host =
      (osmd as unknown as { container?: ParentNode | null }).container ??
      (osmd as unknown as { root?: ParentNode | null }).root ??
      null;
    if (host) syncVfStemsAndBeamsAfterStavenoteAlign(host);
  }
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
