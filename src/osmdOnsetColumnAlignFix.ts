import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  collectLinkedParallelOnsetHintsFromXml,
  type LinkedParallelOnsetHint,
} from '../shared/musicXmlTimelineCleanup';
import {
  collectPreviewNoteLayoutTargetsFromXml,
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
 * play-order align은 `.vf-stavenote`만 translate한다.
 * VexFlow/OSMD는 빔 멤버의 줄기를 형제 `.vf-stem`으로, 빔을 `.vf-beam`으로 두어
 * 음머리만 밀리면 빔·줄기가 앞쪽(원래 자리)에 남아 끊긴 것처럼 보인다.
 * 같은 마디에서 줄기·빔(·이음줄)을 음표 shift에 맞춘다.
 */
export function syncVfStemsAndBeamsAfterStavenoteAlign(root: ParentNode): void {
  const measures = root.querySelectorAll?.('.vf-measure') ?? [];
  for (const measure of measures) {
    syncVfEngravingInMeasure(measure);
  }
}

function syncVfEngravingInMeasure(measure: Element): void {
  const stavenotes = [
    ...measure.querySelectorAll(':scope > .vf-stavenote, :scope > .vf-staveNote'),
  ] as SVGGraphicsElement[];
  if (!stavenotes.length) return;

  type NoteShift = { el: SVGGraphicsElement; naturalX: number; dx: number };
  const notes: NoteShift[] = [];
  for (const sn of stavenotes) {
    const dx = readElementTranslateX(sn);
    const center = noteheadCenterXInSvgRoot(sn) ?? restCenterXInSvgRoot(sn);
    if (center == null || !Number.isFinite(center)) continue;
    notes.push({ el: sn, naturalX: center - dx, dx });
  }
  if (!notes.length) return;

  const nearestNote = (x: number): NoteShift | null => {
    let best: NoteShift | null = null;
    let bestDist = Infinity;
    for (const n of notes) {
      const d = Math.abs(n.naturalX - x);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    // 같은 마디 안 매칭 — 너무 멀면(다른 성부 잔여) 스킵
    if (!best || bestDist > 40) return null;
    return best;
  };

  const stemEls = [
    ...measure.querySelectorAll(':scope > .vf-stem, :scope > [class*="vf-stem"]'),
  ] as SVGGraphicsElement[];
  for (const stem of stemEls) {
    const localX = stemLocalX(stem);
    if (localX == null) continue;
    const naturalX = svgUserXFromElement(stem, localX) - readElementTranslateX(stem);
    const note = nearestNote(naturalX);
    if (!note) continue;
    const cur = readElementTranslateX(stem);
    const need = note.dx - cur;
    if (Math.abs(need) >= 0.01) applySvgTranslateX(stem, need, Math.abs(need) + 1);
  }

  const reshapeByEndpoints = (el: Element, pad = 24): void => {
    const paths = [...el.querySelectorAll('path')];
    if (!paths.length) return;

    type End = { naturalLocalX: number; dx: number };
    const ends: End[] = [];
    for (const stem of stemEls) {
      const localX = stemLocalX(stem);
      if (localX == null) continue;
      ends.push({ naturalLocalX: localX, dx: readElementTranslateX(stem) });
    }
    if (ends.length < 2) {
      for (const n of notes) {
        // notehead user-x − 조상 보정 없이 dx만 씀
        ends.push({ naturalLocalX: n.naturalX, dx: n.dx });
      }
    }
    if (ends.length < 2) return;

    for (const path of paths) {
      const d = path.getAttribute('d');
      if (!d) continue;
      const xs: number[] = [];
      const xToks = d.match(/[MmLl]\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g);
      if (xToks) {
        for (const m of xToks) {
          const n = parseFloat(m.replace(/[MmLl]\s*/, ''));
          if (Number.isFinite(n)) xs.push(n);
        }
      }
      if (xs.length < 2) continue;
      const oldLeft = Math.min(...xs);
      const oldRight = Math.max(...xs);
      if (oldRight - oldLeft < 1) continue;

      const leftEnd = ends
        .slice()
        .sort((a, b) => Math.abs(a.naturalLocalX - oldLeft) - Math.abs(b.naturalLocalX - oldLeft))[0]!;
      const rightEnd = ends
        .slice()
        .sort((a, b) => Math.abs(a.naturalLocalX - oldRight) - Math.abs(b.naturalLocalX - oldRight))[0]!;
      if (leftEnd === rightEnd) continue;
      if (Math.abs(leftEnd.naturalLocalX - oldLeft) > pad && Math.abs(rightEnd.naturalLocalX - oldRight) > pad) {
        continue;
      }
      if (Math.abs(leftEnd.dx) < 0.2 && Math.abs(rightEnd.dx) < 0.2) continue;

      const mapX = (x: number) => {
        const t = (x - oldLeft) / (oldRight - oldLeft);
        return x + (1 - t) * leftEnd.dx + t * rightEnd.dx;
      };
      path.setAttribute('d', mapSvgPathXs(d, mapX));
    }
  };

  for (const beam of measure.querySelectorAll(':scope > .vf-beam, :scope > [class*="vf-beam"]')) {
    reshapeByEndpoints(beam);
  }
  for (const tie of measure.querySelectorAll(':scope > .vf-stavetie, :scope > [class*="vf-tie"]')) {
    reshapeByEndpoints(tie, 48);
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

  const staff = staffIndex + 1;
  // 이전 pass translate를 지우고 natural x로 span·배치(반복 호출 시 origin이 왼쪽으로 붕괴하지 않음)
  for (const h of collectMeasureNoteHits(osmd, gmRaw)) clearStavenoteTranslateX(h.stavenote);
  const hits = collectMeasureNoteHits(osmd, gmRaw);
  if (!hits.length) return;

  const explicitTargets = targets.filter((t) => {
    if (t.measureNumber !== measureNumber) return false;
    if (!partIdsMatch(partId, t.partId)) return false;
    if (t.staff !== 1 && t.staff !== staff) return false;
    return t.playOrder != null;
  });
  if (!explicitTargets.length) return;

  const byPo = new Map<number, PreviewNoteLayoutTarget[]>();
  for (const t of explicitTargets) {
    const po = t.playOrder!;
    const list = byPo.get(po) ?? [];
    list.push(t);
    byPo.set(po, list);
  }

  const measureSpan = playOrderPlacementSpan(hits, byPo.size);
  if (!measureSpan) return;

  const usedHits = new Set<SVGGraphicsElement>();
  for (const po of [...byPo.keys()].sort((a, b) => a - b)) {
    const group = byPo.get(po)!;
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

/**
 * 명시 연주순번 — 같은 playOrder끼리 상대 snap(다성부 column).
 * layout-x가 아직 안 맞아도 같은 순번이면 당긴다.
 * 같은 voice에 서로 다른 layout-x가 같은 po로 남아 있으면(옛 전파) 그 voice는 제외.
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

  const staff = staffIndex + 1;
  const hits = collectMeasureNoteHits(osmd, gmRaw);
  if (!hits.length) return;

  const measureSpanPx = measureSpanFromHits(hits)?.spanPx ?? null;

  const byPo = new Map<number, PreviewNoteLayoutTarget[]>();
  for (const t of targets) {
    if (t.measureNumber !== measureNumber) continue;
    if (!partIdsMatch(partId, t.partId)) continue;
    if (t.staff !== 1 && t.staff !== staff) continue;
    if (t.playOrder == null) continue;
    const list = byPo.get(t.playOrder) ?? [];
    list.push(t);
    byPo.set(t.playOrder, list);
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

export function alignOsmdPreviewNotesByOnsetColumn(
  osmd: OpenSheetMusicDisplay,
  previewXml?: string | null,
): void {
  const xml = resolvePreviewXml(osmd, previewXml);
  const hints = xml ? collectLinkedParallelOnsetHintsFromXml(xml) : [];

  // 명시적 다단 수직 정렬 hint(linked parallel)가 있을 때만 최소한으로 보정.
  // 일반 마디는 MusicXML 마디 편집기 데이터 그대로 OSMD가 자연스럽게 음표·줄기·빔·이음줄을 렌더링하도록 둠.
  if (hints.length > 0) {
    alignLinkedParallelHintGroups(osmd, hints);
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
