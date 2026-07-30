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
  if (Math.abs(dxRoot) > maxShiftPx) return;
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
 * 오선(stave) bbox → SVG root X span.
 * 음표 natural centerX로 span을 잡으면 voice2가 이미 오른쪽으로 밀린 상태라
 * layout tenths→px 매핑이 그 잘못된 위치에 고정된다(회귀 원인).
 */
function staveSpanInSvgRoot(stavenote: SVGGraphicsElement): { originX: number; spanPx: number } | null {
  const stave = stavenote.closest('.vf-stave') as SVGGraphicsElement | null;
  const tryBBox = (el: SVGGraphicsElement | null): { originX: number; spanPx: number } | null => {
    if (!el?.getBBox) return null;
    try {
      const bb = el.getBBox();
      if (!(bb.width > 0)) return null;
      const ctm = el.getCTM?.();
      if (ctm) return { originX: ctm.e + ctm.a * bb.x, spanPx: Math.abs(ctm.a) * bb.width };
      let tx = 0;
      let cur: Element | null = el;
      while (cur) {
        const tr = cur.getAttribute?.('transform') ?? '';
        const tm = /translate\(\s*([-\d.]+)/.exec(tr);
        if (tm) tx += parseFloat(tm[1]!);
        cur = cur.parentElement;
      }
      return { originX: tx + bb.x, spanPx: bb.width };
    } catch {
      return null;
    }
  };
  const fromStave = tryBBox(stave);
  if (fromStave) return fromStave;
  const svg = stavenote.ownerSVGElement as SVGGraphicsElement | null;
  return tryBBox(svg);
}

/**
 * 각 notehead를 data-osmd-layout-x(default-x tenths) column으로 이동.
 * OSMD natural 위치와 무관한 **오선 절대 비율**만 사용 — natural calibration 금지.
 */
function alignStavenoteToTarget(
  stavenote: SVGGraphicsElement,
  defaultXTenths: number,
  centerX: number,
): void {
  const span = staveSpanInSvgRoot(stavenote);
  if (!span || span.spanPx <= 0) return;
  const wantX = targetXFromDefaultTenths(span.originX, span.spanPx, defaultXTenths);
  const maxShift = Math.max(MAX_ONSET_ALIGN_SHIFT_PX, span.spanPx);
  applySvgTranslateX(stavenote, wantX - centerX, maxShift);
}

type LayoutTarget = { defaultXTenths: number; playOrder: number | null };

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

/**
 * voice·pitch queue로 각 음표를 자기 default-x에 맞춤.
 * 서로 다른 연주순번을 한 column으로 강제 snap하지 않음(이전 회귀).
 */
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
        });
      }
    }
  }
  if (!hits.length) return;

  /**
   * PR/PL flatten 후 XML staff는 항상 1.
   * forEachGraphicalMeasure의 staffIndex는 **시스템 안 줄 순번**(전체 악보면 0..N)이라
   * staffIndex+1 을 MusicXML staff로 쓰면 타깃 키와 불일치 → align 전체 스킵.
   * partId(+PR/PL)로 이미 줄이 갈리므로 layout 타깃 staff는 1을 우선하고, 없으면 staffIndex+1.
   */
  const staffCandidates = [1, staff];

  const hitsByKey = new Map<string, NoteHit[]>();
  for (const hit of hits) {
    let matchedKey: string | null = null;
    for (const st of staffCandidates) {
      const key = layoutTargetKey(partId, measureNumber, st, hit.voice, hit.pitch);
      if (pitchQueues.has(key)) {
        matchedKey = key;
        break;
      }
      // P5 vs P5__PR: try base part id keys already in pitchQueues via partIdsMatch below
    }
    if (!matchedKey) {
      // partId may be P5 while targets use P5__PR or vice versa — resolve by scanning queues
      for (const [key, list] of pitchQueues) {
        if (!list.length) continue;
        const [pid, mn, , voice, pitch] = key.split('|');
        if (mn !== String(measureNumber) || voice !== hit.voice || pitch !== hit.pitch) continue;
        if (!partIdsMatch(partId, pid!)) continue;
        matchedKey = key;
        break;
      }
    }
    if (!matchedKey) {
      matchedKey = layoutTargetKey(partId, measureNumber, 1, hit.voice, hit.pitch);
    }
    const list = hitsByKey.get(matchedKey) ?? [];
    list.push(hit);
    hitsByKey.set(matchedKey, list);
  }

  const pairs: Array<{ hit: NoteHit; target: LayoutTarget }> = [];
  for (const [key, keyHits] of hitsByKey) {
    const targets = pitchQueues.get(key) ?? [];
    if (!targets.length) continue;
    pairs.push(...pairHitsWithLayoutTargetsByBestMatch(keyHits, targets));
  }

  for (const { hit, target } of pairs) {
    alignStavenoteToTarget(hit.stavenote, target.defaultXTenths, hit.centerX);
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

function alignPlayOrderGroupForce(items: StaveGraphic[]): void {
  const bySvg = new Map<SVGGraphicsElement, StaveGraphic>();
  for (const item of items) {
    const prev = bySvg.get(item.svg);
    if (!prev || item.centerX < prev.centerX) bySvg.set(item.svg, item);
  }
  const unique = [...bySvg.values()];
  if (unique.length < 2) return;
  const anchorX = Math.min(...unique.map((u) => u.centerX));
  const maxShift = Math.max(
    MAX_ONSET_ALIGN_SHIFT_PX,
    ...unique.map((u) => Math.abs(anchorX - u.centerX)),
  );
  for (const u of unique) {
    applySvgTranslateX(u.svg, anchorX - u.centerX, maxShift);
  }
}

/**
 * 명시 연주순번 — **같은 playOrder·같은 default-x column**끼리만 상대 snap.
 * (절대 default-x 이동은 alignMeasureNotesByLayoutGrid가 담당 — 다른 po 강제 합침 금지)
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
        });
      }
    }
  }
  if (!hits.length) return;

  const columnQueues = new Map<string, PreviewNoteLayoutTarget[]>();
  for (const t of targets) {
    if (t.measureNumber !== measureNumber) continue;
    if (!partIdsMatch(partId, t.partId)) continue;
    // XML staff after PR/PL flatten is 1; staffIndex is OSMD row index (전체 악보에서 ≠ staff)
    if (t.staff !== 1 && t.staff !== staff) continue;
    if (t.playOrder == null) continue;
    const colKey = `${t.playOrder}|${t.defaultXTenths.toFixed(2)}`;
    const list = columnQueues.get(colKey) ?? [];
    list.push(t);
    columnQueues.set(colKey, list);
  }

  for (const queue of columnQueues.values()) {
    if (queue.length < 2) continue;
    const byVoicePitch = new Map<string, PreviewNoteLayoutTarget[]>();
    for (const t of queue) {
      const vp = `${t.voice}|${t.pitch}`;
      const list = byVoicePitch.get(vp) ?? [];
      list.push(t);
      byVoicePitch.set(vp, list);
    }
    const cluster: StaveGraphic[] = [];
    const usedSvg = new Set<SVGGraphicsElement>();
    for (const [vp, tlist] of byVoicePitch) {
      const candidates = hits.filter(
        (h) => `${h.voice}|${h.pitch}` === vp && !usedSvg.has(h.stavenote),
      );
      if (!candidates.length) continue;
      const vpPairs = pairHitsWithLayoutTargetsByBestMatch(
        candidates,
        tlist.map((t) => ({ defaultXTenths: t.defaultXTenths, playOrder: t.playOrder })),
      );
      for (const { hit } of vpPairs) {
        if (usedSvg.has(hit.stavenote)) continue;
        usedSvg.add(hit.stavenote);
        cluster.push({ svg: hit.stavenote, centerX: hit.centerX });
      }
    }
    if (cluster.length >= 2) alignPlayOrderGroupForce(cluster);
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

  // 1) 각 음표 → 자기 default-x column (오선 절대 비율; natural calibration 금지)
  const pitchQueues = new Map<string, LayoutTarget[]>();
  for (const t of targets) {
    const key = layoutTargetKey(t.partId, t.measureNumber, t.staff, t.voice, t.pitch);
    const list = pitchQueues.get(key) ?? [];
    list.push({ defaultXTenths: t.defaultXTenths, playOrder: t.playOrder });
    pitchQueues.set(key, list);
  }
  forEachGraphicalMeasure(osmd, (gmRaw, staffIndex) => {
    alignMeasureNotesByLayoutGrid(osmd, gmRaw, staffIndex, pitchQueues);
  });

  // 2) 명시 연주순번 — 같은 po·같은 default-x column만 상대 snap (다른 순번 강제 합침 금지)
  //    step1 이후 centerX를 다시 읽어 E5↔[F4,Bb4] 등 잔여 오차를 맞춤
  forEachGraphicalMeasure(osmd, (gmRaw, staffIndex) => {
    alignExplicitPlayOrderColumnsRelative(osmd, gmRaw, staffIndex, targets);
  });

  // 3) linkParallel — anchor timestamp 기준 상대 snap
  alignLinkedParallelHintGroups(osmd, hints);
  // 같은 pitch·다른 po(F4@po2 vs F4@po4)를 pitch만으로 묶는 전역 group snap은
  // 뒤 column을 앞 column으로 끌어당기므로 쓰지 않음 — step 2가 column-safe.
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
