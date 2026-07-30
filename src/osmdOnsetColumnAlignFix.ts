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
    if (ctm) {
      xs.push(ctm.a * localX + ctm.e);
      continue;
    }
    let tx = 0;
    let cur: Element | null = pathEl;
    while (cur) {
      const tr = cur.getAttribute?.('transform') ?? '';
      const tm = /translate\(\s*([-\d.]+)/.exec(tr);
      if (tm) tx += parseFloat(tm[1]!);
      cur = cur.parentElement;
    }
    xs.push(tx + localX);
  }
  if (!xs.length) {
    const bb = stavenote.getBBox?.();
    if (bb && bb.width > 0) {
      let tx = 0;
      let cur: Element | null = stavenote;
      while (cur) {
        const tr = cur.getAttribute?.('transform') ?? '';
        const tm = /translate\(\s*([-\d.]+)/.exec(tr);
        if (tm) tx += parseFloat(tm[1]!);
        cur = cur.parentElement;
      }
      return tx + bb.x + bb.width / 2;
    }
    return null;
  }
  return xs.reduce((a, b) => a + b, 0) / xs.length;
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
  // 한 번에 상한까지라도 당김 — 예전엔 over-cap이면 아예 스킵해 voice2가 멀리 남음
  const capped = Math.sign(dxRoot) * Math.min(Math.abs(dxRoot), maxShiftPx);
  if (Math.abs(capped) < 0.01) return;
  const ctm = svg.getCTM?.();
  const scale = ctm && Math.abs(ctm.a) > 1e-6 ? ctm.a : 1;
  const dx = capped / scale;
  const tr = svg.getAttribute('transform') ?? '';
  const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(tr);
  const ox = m ? parseFloat(m[1]!) : 0;
  const oy = m ? parseFloat(m[2] ?? '0') : 0;
  const rest = tr.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
  const prefix = `translate(${ox + dx}, ${oy})`;
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
  pitch: string;
  voice: string;
  centerX: number;
  /** OSMD voice-entry timestamp — duplicate voice·pitch 매칭에 x보다 신뢰 */
  timestamp: number | null;
  /** 화음 notehead 수 — [F4,Bb4](2) vs [F4,Bb4,D5,F5](4) 구분 */
  heads: number;
};

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
 * 같은 layout tenths에 여러 natural x가 있을 때(E5·F4 po2) 왼쪽에 가까운 쪽을 앵커로.
 * 오른쪽 voice2가 minCenterX를 덮어쓰던 calibration 회귀 방지.
 */
function buildSafeMeasureCalibration(
  pairs: Array<{ centerX: number; defaultXTenths: number; voice: string }>,
): { originX: number; spanPx: number; tenthsMin: number; tenthsMax: number } | null {
  if (pairs.length < 2) return null;

  // voice1 우선 앵커 — OSMD가 보통 올바르게 배치
  const v1 = pairs.filter((p) => p.voice === '1');
  const anchorPool = v1.length >= 2 ? v1 : pairs;

  const byTenths = new Map<number, number[]>();
  for (const p of anchorPool) {
    const t = Math.round(p.defaultXTenths * 100) / 100;
    const list = byTenths.get(t) ?? [];
    list.push(p.centerX);
    byTenths.set(t, list);
  }
  if (byTenths.size < 2) {
    // tenths가 하나뿐이면 마디 natural span만 (비율 매핑 불가)
    return null;
  }

  const anchors: Array<{ tenths: number; x: number }> = [];
  for (const [tenths, xs] of byTenths) {
    anchors.push({ tenths, x: Math.min(...xs) }); // 같은 column은 왼쪽 우선
  }
  anchors.sort((a, b) => a.tenths - b.tenths);
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (last.tenths <= first.tenths || last.x <= first.x) return null;

  return {
    originX: first.x,
    spanPx: last.x - first.x,
    tenthsMin: first.tenths,
    tenthsMax: last.tenths,
  };
}

function wantXFromSafeCalibration(
  cal: { originX: number; spanPx: number; tenthsMin: number; tenthsMax: number },
  defaultXTenths: number,
): number {
  const frac = (defaultXTenths - cal.tenthsMin) / (cal.tenthsMax - cal.tenthsMin);
  return cal.originX + frac * cal.spanPx;
}

/** 명시 연주순번만 절대 이동 — voice1이 잡은 마디 span에 layout-x 비율로 배치. */
function alignStavenoteToTarget(
  stavenote: SVGGraphicsElement,
  defaultXTenths: number,
  centerX: number,
  cal: { originX: number; spanPx: number; tenthsMin: number; tenthsMax: number } | null,
  measureSpan: { originX: number; spanPx: number } | null,
): void {
  let wantX: number;
  if (cal) {
    wantX = wantXFromSafeCalibration(cal, defaultXTenths);
  } else if (measureSpan) {
    wantX = targetXFromDefaultTenths(measureSpan.originX, measureSpan.spanPx, defaultXTenths);
  } else {
    return;
  }
  const dx = wantX - centerX;
  // 그리드 배치: 마디 폭만큼은 반드시 이동(포기하지 않음)
  const cap = Math.max(
    MAX_ONSET_ALIGN_SHIFT_PX,
    (measureSpan?.spanPx ?? cal?.spanPx ?? 240) * 2,
  );
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

/** voice1(또는 전체) notehead로 마디 SVG span — layout tenths를 이 폭에 비례 배치. */
function measureSpanFromVoice1Hits(hits: readonly NoteHit[]): { originX: number; spanPx: number } | null {
  const v1 = hits.filter((h) => h.voice === '1');
  const pool = v1.length >= 2 ? v1 : hits;
  return measureSpanFromHits(pool);
}

/**
 * 연주순번 layout-x 그리드 → SVG 절대 배치.
 * voice1이 잡은 마디 폭에 tenths를 매핑해 [F4,Bb4]도 E5 column으로 이동.
 */
function alignMeasureNotesByPlayOrderGrid(
  osmd: OpenSheetMusicDisplay,
  gmRaw: unknown,
  staffIndex: number,
  targets: readonly PreviewNoteLayoutTarget[],
): void {
  const partId = partIdFromGraphic(gmRaw);
  const measureNumber = measureMxlFromGraphic(gmRaw);
  if (!partId || measureNumber == null) return;

  const staff = staffIndex + 1;
  const gm = asRecord(gmRaw);
  if (!gm) return;

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
        const voice = voiceFromGraphicNote(gn) ?? '1';
        const stavenote = graphicNoteStavenote(osmd, gn);
        if (!stavenote || seenStavenote.has(stavenote)) continue;
        seenStavenote.add(stavenote);
        const centerX = noteheadCenterXInSvgRoot(stavenote);
        if (centerX == null || !Number.isFinite(centerX)) continue;
        hits.push({
          stavenote,
          pitch,
          voice,
          centerX,
          timestamp: osmdTimestampFromGraphicVoiceEntry(gve),
          heads: stavenote.querySelectorAll('.vf-notehead').length,
        });
      }
    }
  }
  if (!hits.length) return;

  const staffTargets = targets.filter((t) => {
    if (t.measureNumber !== measureNumber) return false;
    if (!partIdsMatch(partId, t.partId)) return false;
    if (t.staff !== 1 && t.staff !== staff) return false;
    return true;
  });
  if (!staffTargets.length) return;

  // 연주순번이 있는 음만 그리드 배치(사용자 지정 column). 없으면 OSMD 유지.
  const explicitTargets = staffTargets.filter((t) => t.playOrder != null);
  if (!explicitTargets.length) return;

  const pitchQueues = new Map<string, LayoutTarget[]>();
  for (const t of explicitTargets) {
    const key = `${t.voice}|${t.pitch}`;
    const list = pitchQueues.get(key) ?? [];
    list.push({
      defaultXTenths: t.defaultXTenths,
      playOrder: t.playOrder,
      pitch: t.pitch,
      voice: t.voice,
    });
    pitchQueues.set(key, list);
  }
  for (const list of pitchQueues.values()) {
    list.sort((a, b) => a.defaultXTenths - b.defaultXTenths);
  }

  const measureSpan = measureSpanFromVoice1Hits(hits);

  // voice1 hit × voice1 target 로 calibration (tenths 비율 → SVG px)
  const v1Hits = hits.filter((h) => h.voice === '1');
  const v1Targets = explicitTargets.filter((t) => t.voice === '1');
  const calInput: Array<{ centerX: number; defaultXTenths: number; voice: string }> = [];
  const usedV1 = new Set<SVGGraphicsElement>();
  const byPitch = new Map<string, PreviewNoteLayoutTarget[]>();
  for (const t of v1Targets) {
    const list = byPitch.get(t.pitch) ?? [];
    list.push(t);
    byPitch.set(t.pitch, list);
  }
  for (const [pitch, tlist] of byPitch) {
    const sortedT = [...tlist].sort((a, b) => a.defaultXTenths - b.defaultXTenths);
    const candidates = v1Hits
      .filter((h) => h.pitch === pitch && !usedV1.has(h.stavenote))
      .sort((a, b) => {
        const ta = a.timestamp;
        const tb = b.timestamp;
        if (ta != null && tb != null && Math.abs(ta - tb) > 1e-4) return ta - tb;
        return a.centerX - b.centerX;
      });
    const n = Math.min(sortedT.length, candidates.length);
    for (let i = 0; i < n; i += 1) {
      usedV1.add(candidates[i]!.stavenote);
      calInput.push({
        centerX: candidates[i]!.centerX,
        defaultXTenths: sortedT[i]!.defaultXTenths,
        voice: '1',
      });
    }
  }
  const cal = buildSafeMeasureCalibration(calInput);

  const pairs: Array<{ hit: NoteHit; target: LayoutTarget }> = [];
  const usedHits = new Set<SVGGraphicsElement>();
  for (const [key, queue] of pitchQueues) {
    const [voice, pitch] = key.split('|') as [string, string];
    const expectedByPo = new Map<number, number>();
    for (const t of queue) {
      if (t.playOrder == null) continue;
      const pitches = new Set(
        explicitTargets.filter((x) => x.playOrder === t.playOrder && x.voice === voice).map((x) => x.pitch),
      );
      expectedByPo.set(t.playOrder, pitches.size);
    }
    const candidates = hits
      .filter((h) => h.voice === voice && h.pitch === pitch && !usedHits.has(h.stavenote))
      .sort((a, b) => {
        const ta = a.timestamp;
        const tb = b.timestamp;
        if (ta != null && tb != null && Math.abs(ta - tb) > 1e-4) return ta - tb;
        return a.centerX - b.centerX;
      });
    // column 왼→오: 각 target에 heads 맞는 hit 배정
    for (const target of queue) {
      const expectHeads = target.playOrder != null ? expectedByPo.get(target.playOrder) ?? 1 : 1;
      let bestIdx = -1;
      let bestScore = Infinity;
      for (let i = 0; i < candidates.length; i += 1) {
        const h = candidates[i]!;
        if (usedHits.has(h.stavenote)) continue;
        const headPenalty = expectHeads > 1 ? Math.abs(h.heads - expectHeads) * 1000 : 0;
        const score = headPenalty + i;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) continue;
      const hit = candidates[bestIdx]!;
      usedHits.add(hit.stavenote);
      pairs.push({ hit, target });
    }
  }

  for (const { hit, target } of pairs) {
    alignStavenoteToTarget(hit.stavenote, target.defaultXTenths, hit.centerX, cal, measureSpan);
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
  const partId = partIdFromGraphic(gmRaw);
  const measureNumber = measureMxlFromGraphic(gmRaw);
  if (!partId || measureNumber == null) return;

  const staff = staffIndex + 1;
  const gm = asRecord(gmRaw);
  if (!gm) return;

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
        const voice = voiceFromGraphicNote(gn) ?? '1';
        const stavenote = graphicNoteStavenote(osmd, gn);
        if (!stavenote || seenStavenote.has(stavenote)) continue;
        seenStavenote.add(stavenote);
        const centerX = noteheadCenterXInSvgRoot(stavenote);
        if (centerX == null || !Number.isFinite(centerX)) continue;
        hits.push({
          stavenote,
          pitch,
          voice,
          centerX,
          timestamp: osmdTimestampFromGraphicVoiceEntry(gve),
          heads: stavenote.querySelectorAll('.vf-notehead').length,
        });
      }
    }
  }
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
        .filter((h) => `${h.voice}|${h.pitch}` === vp && !usedAcrossColumns.has(h.stavenote))
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
  const targets = xml ? collectPreviewNoteLayoutTargetsFromXml(xml) : [];
  const hints = xml ? collectLinkedParallelOnsetHintsFromXml(xml) : [];

  // 1) 연주순번 slot 그리드(layout-x) → SVG 절대 배치 (voice1 마디 비율)
  // 2) 같은 순번끼리 상대 snap으로 잔여 오차 제거
  forEachGraphicalMeasure(osmd, (gmRaw, staffIndex) => {
    alignMeasureNotesByPlayOrderGrid(osmd, gmRaw, staffIndex, targets);
    alignExplicitPlayOrderColumnsRelative(osmd, gmRaw, staffIndex, targets);
  });

  alignLinkedParallelHintGroups(osmd, hints);
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
