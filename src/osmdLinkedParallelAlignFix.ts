import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { LinkedParallelOnsetHint } from '../shared/musicXmlTimelineCleanup';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from './osmdMeasureClick';

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

export function osmdTimestampFromLinkedParallelHint(hint: LinkedParallelOnsetHint): number {
  const len = hint.measureLength > 0 ? hint.measureLength : Math.max(1, hint.divisions);
  return hint.onset / len;
}

function onsetTolerance(hint: LinkedParallelOnsetHint): number {
  const len = Math.max(1, hint.measureLength);
  return 1 / (len * 4);
}

function osmdNotePitchLabel(note: Record<string, unknown>): string | null {
  const pitch = note.Pitch ?? note.pitch;
  if (!pitch || typeof pitch !== 'object') return null;
  const p = pitch as Record<string, unknown>;
  const fn = Number(p.FundamentalNote ?? p.fundamentalNote);
  const oct = Number(p.Octave ?? p.octave);
  const acc = Number(p.Accidental ?? p.accidental ?? 0);
  const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  if (!Number.isFinite(fn) || fn < 0 || fn > 6 || !Number.isFinite(oct)) return null;
  const accStr = acc < 0 ? 'b' : acc > 0 ? '#' : '';
  return `${names[fn]}${accStr}${oct}`;
}

/** notehead path → SVG 루트 사용자 좌표(줌·CSS와 무관). */
function noteheadCenterXInSvgRoot(stavenote: SVGGraphicsElement): number | null {
  const svg = stavenote.ownerSVGElement;
  if (!svg) return null;
  const xs: number[] = [];
  for (const path of stavenote.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const pt = svg.createSVGPoint();
    pt.x = parseFloat(m[1]!);
    pt.y = 0;
    const pathEl = path as SVGGraphicsElement;
    const ctm = pathEl.getCTM?.() ?? stavenote.getCTM?.();
    if (ctm) xs.push(pt.matrixTransform(ctm).x);
  }
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function readStavenoteSvgX(stavenote: SVGGraphicsElement): number | null {
  return noteheadCenterXInSvgRoot(stavenote);
}

function localHorizontalDx(stavenote: SVGGraphicsElement, dxRoot: number): number {
  const parent = stavenote.parentElement as SVGGraphicsElement | null;
  const scale = parent?.getCTM?.()?.a;
  if (typeof scale === 'number' && Number.isFinite(scale) && Math.abs(scale) > 1e-6) {
    return dxRoot / scale;
  }
  return dxRoot;
}

function applySvgTranslateX(svg: SVGGraphicsElement, dxRoot: number): void {
  const dx = localHorizontalDx(svg, dxRoot);
  if (Math.abs(dx) < 0.01) return;
  const tr = svg.getAttribute('transform') ?? '';
  const m = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(tr);
  const ox = m ? parseFloat(m[1]!) : 0;
  const oy = m ? parseFloat(m[2] ?? '0') : 0;
  const rest = tr.replace(/translate\(\s*[-\d.]+\s*(?:,\s*[-\d.]+)?\s*\)/, '').trim();
  const prefix = `translate(${ox + dx}, ${oy})`;
  svg.setAttribute('transform', rest ? `${prefix} ${rest}` : prefix);
}

type NoteTarget = {
  voice: string;
  pitch: string | null;
  svg: SVGGraphicsElement;
  centerX: number;
};

function voiceFromGraphicalNote(gn: Record<string, unknown>): string | null {
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  const vn = src?.Voice ?? src?.voice;
  if (typeof vn === 'number' && Number.isFinite(vn)) return String(vn);
  if (typeof vn === 'string' && vn.trim()) return vn.trim();
  return null;
}

function collectNoteTargetsFromGraphic(
  osmd: OpenSheetMusicDisplay,
  hint: LinkedParallelOnsetHint,
  host: HTMLElement | null,
): NoteTarget[] {
  const targetTs = osmdTimestampFromLinkedParallelHint(hint);
  const tol = onsetTolerance(hint);
  const out: NoteTarget[] = [];

  forEachGraphicalMeasure(osmd, (gmRaw) => {
    if (measureMxlFromGraphic(gmRaw) !== hint.measureNumber) return;
    const gm = asRecord(gmRaw);
    if (!gm) return;

    for (const seRaw of (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[]) {
      const se = asRecord(seRaw);
      if (!se) continue;
      for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        const pve = asRecord(gve.parentVoiceEntry ?? gve.ParentVoiceEntry);
        const ts = coordNum(pve?.Timestamp ?? pve?.timestamp);
        if (ts == null || Math.abs(ts - targetTs) > tol) continue;

        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          if (!gn) continue;
          const voice = voiceFromGraphicalNote(gn);
          if (!voice || !hint.memberVoices.includes(voice)) continue;
          const src = asRecord(gn.sourceNote ?? gn.SourceNote);
          const pitch = src ? osmdNotePitchLabel(src) : null;
          if (hint.memberPitches.length && pitch && !hint.memberPitches.includes(pitch)) continue;

          const svg = (gn as { getSVGGElement?: () => SVGGraphicsElement | null }).getSVGGElement?.();
          if (!svg) continue;
          const stavenote =
            svg.classList.contains('vf-stavenote') || svg.classList.contains('vf-staveNote')
              ? svg
              : (svg.closest('.vf-stavenote, .vf-staveNote') as SVGGraphicsElement | null) ?? svg;
          const centerX = readStavenoteSvgX(stavenote);
          if (centerX == null || !Number.isFinite(centerX)) continue;
          out.push({ voice, pitch, svg: stavenote, centerX });
        }
      }
    }
  });

  return out;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * linkParallelOnsets — OSMD/VexFlow voice column 간격으로 벌어진 동시 onset notehead x만 맞춤.
 * MusicXML voice·duration·beam은 건드리지 않음. render() 직후 호출.
 */
export function alignLinkedParallelOnsetGraphics(
  osmd: OpenSheetMusicDisplay,
  hints: readonly LinkedParallelOnsetHint[],
  host?: HTMLElement | null,
): void {
  if (!hints.length) return;
  const hostEl =
    host ??
    asRecord((osmd as unknown as { container?: unknown }).container)?.parentElement ??
    null;

  for (const hint of hints) {
    const targets = collectNoteTargetsFromGraphic(osmd, hint, hostEl);
    if (targets.length < 2) continue;

    const anchorTargets = targets.filter(
      (t) =>
        t.voice === hint.anchorVoice &&
        (!hint.anchorPitch || t.pitch === hint.anchorPitch),
    );
    const anchorX = median(
      (anchorTargets.length ? anchorTargets : targets.filter((t) => t.voice === hint.anchorVoice)).map(
        (t) => t.centerX,
      ),
    );
    if (!Number.isFinite(anchorX)) continue;

    const shifted = new Set<SVGGraphicsElement>();
    for (const t of targets) {
      if (t.voice === hint.anchorVoice && (!hint.anchorPitch || t.pitch === hint.anchorPitch)) continue;
      const dx = anchorX - t.centerX;
      if (Math.abs(dx) < 0.01) continue;
      if (shifted.has(t.svg)) continue;
      shifted.add(t.svg);
      applySvgTranslateX(t.svg, dx);
    }
  }
}

/** linkParallel 힌트가 있으면 VexFlow voice column 간격을 끔(미리보기 전용). */
export function applyLinkedParallelVoiceSpacingForOsmdPreview(
  rules: OpenSheetMusicDisplay['EngravingRules'],
  hintCount: number,
): void {
  if (hintCount <= 0) return;
  rules.VoiceSpacingMultiplierVexflow = 0;
  rules.VoiceSpacingAddendVexflow = 0;
}
