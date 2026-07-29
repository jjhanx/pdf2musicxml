import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  collectLinkedParallelOnsetHintsFromXml,
  type LinkedParallelOnsetHint,
} from '../shared/musicXmlTimelineCleanup';
import {
  collectPlayOrderAlignGroupsFromXml,
  collectPreviewNoteLayoutTargetsFromXml,
  type PlayOrderAlignGroup,
  type PreviewNoteLayoutTarget,
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

/** SVG pixel shift — 좌표계 혼용·과대 이동 시 notehead 소실 방지. */
const MAX_ONSET_ALIGN_SHIFT_PX = 120;

function applySvgTranslateX(svg: SVGGraphicsElement, dxRoot: number): void {
  if (Math.abs(dxRoot) < 0.01) return;
  if (Math.abs(dxRoot) > MAX_ONSET_ALIGN_SHIFT_PX) return;
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

function partIdsMatch(graphicPartId: string, targetPartId: string): boolean {
  const base = targetPartId.replace(/__PR$|__PL$/, '');
  return (
    graphicPartId === targetPartId ||
    graphicPartId === base ||
    graphicPartId === `${base}__PR` ||
    graphicPartId === `${base}__PL`
  );
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
  const maxShift = Math.max(...unique.map((u) => Math.abs(anchorX - u.centerX)));
  if (maxShift > MAX_ONSET_ALIGN_SHIFT_PX) return;
  for (const u of unique) {
    applySvgTranslateX(u.svg, anchorX - u.centerX);
  }
}

/**
 * 명시 연주순번 — **같은 playOrder·같은 default-x column**끼리만 상대 snap.
 * 절대 default-x 이동·전 마디 explicit 강제 스냅은 4분음이 1번에 뭉치고 8분음이 사라지게 함.
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

  type NoteHit = { stavenote: SVGGraphicsElement; pitch: string; voice: string; centerX: number };
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
        hits.push({ stavenote, pitch, voice, centerX });
      }
    }
  }
  if (!hits.length) return;

  const columnQueues = new Map<string, PreviewNoteLayoutTarget[]>();
  for (const t of targets) {
    if (t.partId !== partId || t.measureNumber !== measureNumber || t.staff !== staff) continue;
    if (t.playOrder == null) continue;
    const colKey = `${t.playOrder}|${t.defaultXTenths.toFixed(2)}`;
    const list = columnQueues.get(colKey) ?? [];
    list.push(t);
    columnQueues.set(colKey, list);
  }

  for (const queue of columnQueues.values()) {
    if (queue.length < 2) continue;
    const remaining = new Map<string, PreviewNoteLayoutTarget[]>();
    for (const t of queue) {
      const key = `${t.voice}|${t.pitch}`;
      const list = remaining.get(key) ?? [];
      list.push(t);
      remaining.set(key, list);
    }
    const cluster: StaveGraphic[] = [];
    for (const hit of hits) {
      const key = `${hit.voice}|${hit.pitch}`;
      const list = remaining.get(key);
      if (!list?.length) continue;
      list.shift();
      cluster.push({ svg: hit.stavenote, centerX: hit.centerX });
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

function collectGraphicsForGroup(
  osmd: OpenSheetMusicDisplay,
  group: PlayOrderAlignGroup,
  targets: readonly PreviewNoteLayoutTarget[],
): StaveGraphic[] {
  const columnTargets = targets.filter(
    (t) =>
      t.partId === group.partId &&
      t.measureNumber === group.measureNumber &&
      t.staff === group.staff &&
      t.playOrder === group.playOrder,
  );
  if (columnTargets.length < 2) return [];
  const columnTenths = new Set(columnTargets.map((t) => t.defaultXTenths.toFixed(2)));
  // 같은 순번이어도 default-x가 갈라지면(잘못된 전파 잔여) 한 column으로 강제하지 않음
  if (columnTenths.size !== 1) return [];

  const items: StaveGraphic[] = [];
  const remaining = new Map<string, number>();
  for (const t of columnTargets) {
    const key = `${t.voice}|${t.pitch}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const graphicPartId = partIdFromGraphic(gmRaw);
    if (!graphicPartId || !partIdsMatch(graphicPartId, group.partId)) return;
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
          if (!pitch) continue;
          const voice = voiceFromGraphicNote(gn) ?? '1';
          const key = `${voice}|${pitch}`;
          const left = remaining.get(key) ?? 0;
          if (left <= 0) continue;
          remaining.set(key, left - 1);
          const stavenote = graphicNoteStavenote(osmd, gn);
          if (!stavenote) continue;
          const centerX = noteheadCenterXInSvgRoot(stavenote);
          if (centerX == null || !Number.isFinite(centerX)) continue;
          items.push({ svg: stavenote, centerX });
        }
      }
    }
  });
  return items;
}

export function alignOsmdPreviewNotesByOnsetColumn(
  osmd: OpenSheetMusicDisplay,
  previewXml?: string | null,
): void {
  const xml = resolvePreviewXml(osmd, previewXml);
  const targets = xml ? collectPreviewNoteLayoutTargetsFromXml(xml) : [];
  const hints = xml ? collectLinkedParallelOnsetHintsFromXml(xml) : [];

  // 1) 명시 연주순번 — 같은 po·같은 default-x column만 상대 snap (절대 좌표 이동 없음)
  forEachGraphicalMeasure(osmd, (gmRaw, staffIndex) => {
    alignExplicitPlayOrderColumnsRelative(osmd, gmRaw, staffIndex, targets);
  });

  // 2) linkParallel — anchor timestamp 기준 상대 snap
  alignLinkedParallelHintGroups(osmd, hints);

  // 3) 명시 순번 그룹(힌트 없는 마디) — voice·pitch queue로 column 멤버만
  const hintedMeasures = new Set(hints.map((h) => `${h.partId}|${h.measureNumber}`));
  const groups = xml ? collectPlayOrderAlignGroupsFromXml(xml) : [];
  for (const group of groups) {
    if (hintedMeasures.has(`${group.partId}|${group.measureNumber}`)) continue;
    const items = collectGraphicsForGroup(osmd, group, targets);
    if (items.length >= 2) alignPlayOrderGroupForce(items);
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
