/**
 * OSMD 미리보기 — 다성부 짧은 쉼표 세로 위치.
 *
 * OSMD(VexFlowConverter)는 display-step이 없으면 voice≠1·5 쉼표를 항상 아래로 밀고,
 * VexFlow align_rests가 켜지면 화음 쪽으로 끌어내린다. GraphicSheet는 render 후에야
 * 채워지므로, load 직후 **SourceNote.Pitch**를 반대편(오선 안·위쪽은 윗줄 근처)으로
 * 고정한 뒤 render한다. 저장 MXL은 그대로다.
 */
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { forEachGraphicalMeasure } from './osmdMeasureClick';
import { applyArticulationShiftY } from './osmdArticulationOffsetFix';

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function coordNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/** OSMD NoteEnum chromatic values */
const NOTE_ENUM = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const;
const ACCIDENTAL_NONE = 2;
const STEP_DIATONIC: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

function callMaybe(obj: unknown, name: string): unknown {
  const rec = asRecord(obj);
  if (!rec) return undefined;
  const fn = rec[name];
  if (typeof fn === 'function') {
    try {
      return (fn as () => unknown).call(obj);
    } catch {
      return undefined;
    }
  }
  return rec[name];
}

function isRestSourceNote(note: Record<string, unknown>): boolean {
  const r = callMaybe(note, 'isRest');
  if (r === true) return true;
  if (typeof note.isRest === 'boolean') return note.isRest;
  if (typeof note.IsRest === 'boolean') return note.IsRest;
  return false;
}

function isWholeOrMeasureRestNote(note: Record<string, unknown>): boolean {
  if (note.IsWholeMeasureRest === true || note.isWholeMeasureRest === true) return true;
  const typeXml = String(note.TypeXml ?? note.typeXml ?? note.NoteTypeXml ?? note.noteTypeXml ?? '')
    .trim()
    .toLowerCase();
  return typeXml === 'whole' || typeXml === 'breve' || typeXml === 'long';
}

function pitchDiatonicFromSourceNote(note: Record<string, unknown>): number | null {
  const pitch = asRecord(note.Pitch ?? note.pitch);
  if (!pitch) return null;
  const fn = coordNum(pitch.FundamentalNote ?? pitch.fundamentalNote);
  const oct = coordNum(pitch.Octave ?? pitch.octave);
  if (fn == null || oct == null) return null;
  // Notes: OSMD octave = MusicXML − 3. Rests: MusicXML octave as-is.
  const xmlOct = isRestSourceNote(note) ? oct : oct + 3;
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  // FundamentalNote is NoteEnum (0,2,4,5,7,9,11) — map to diatonic
  const diatonicIdx = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][fn] ?? 0;
  void steps;
  return xmlOct * 7 + diatonicIdx;
}

function voiceIdFromNote(note: Record<string, unknown>): number | null {
  const pve = asRecord(note.ParentVoiceEntry ?? note.parentVoiceEntry);
  const voice = asRecord(pve?.ParentVoice ?? pve?.parentVoice);
  return coordNum(voice?.VoiceId ?? voice?.voiceId);
}

function wantRestAbove(mid: number, otherDias: number[]): boolean {
  if (otherDias.length === 0) return true;
  if (otherDias.every((p) => p <= mid)) return true;
  if (otherDias.every((p) => p >= mid)) return false;
  return otherDias.reduce((a, b) => a + b, 0) / otherDias.length < mid;
}

/**
 * OSMD rest Pitch uses MusicXML octave (not note's octave-3).
 * 위쪽은 윗줄 근처(F5/A3)로 두어 VexFlow 중선 정렬·glyph이 “아래처럼” 보이는 것을 줄인다.
 */
function restPitchSpec(
  clefKind: 'G' | 'F' | 'C',
  wantAbove: boolean,
): { fundamental: number; octave: number } {
  if (clefKind === 'F') {
    return wantAbove
      ? { fundamental: NOTE_ENUM.A, octave: 3 }
      : { fundamental: NOTE_ENUM.G, octave: 2 };
  }
  if (clefKind === 'C') {
    return wantAbove
      ? { fundamental: NOTE_ENUM.G, octave: 4 }
      : { fundamental: NOTE_ENUM.F, octave: 3 };
  }
  return wantAbove
    ? { fundamental: NOTE_ENUM.F, octave: 5 }
    : { fundamental: NOTE_ENUM.E, octave: 4 };
}

function clefKindFromStaffEntry(se: Record<string, unknown>): 'G' | 'F' | 'C' {
  const staff = asRecord(se.ParentStaff ?? se.parentStaff);
  const clef = asRecord(staff?.ActiveClef ?? staff?.activeClef);
  const t = clef?.ClefType ?? clef?.clefType;
  const s = String(t ?? '').toLowerCase();
  if (t === 1 || s === 'f' || s.includes('bass')) return 'F';
  if (t === 2 || s === 'c' || s.includes('alto') || s.includes('tenor')) return 'C';
  return 'G';
}

function middleDiatonic(kind: 'G' | 'F' | 'C'): number {
  if (kind === 'F') return 3 * 7 + 1;
  if (kind === 'C') return 4 * 7 + 0;
  return 4 * 7 + 6;
}

function setRestPitch(
  rest: Record<string, unknown>,
  donorPitch: unknown,
  fundamental: number,
  octave: number,
): boolean {
  const existing = asRecord(rest.Pitch ?? rest.pitch);
  if (existing) {
    const fo = coordNum(existing.FundamentalNote ?? existing.fundamentalNote);
    const oo = coordNum(existing.Octave ?? existing.octave);
    if (fo === fundamental && oo === octave) return true; // already opposite-side
  }

  const Ctor = donorPitch
    ? (donorPitch as { constructor?: new (...a: unknown[]) => unknown }).constructor
    : existing
      ? (rest.Pitch as { constructor?: new (...a: unknown[]) => unknown })?.constructor
      : null;

  let next: unknown;
  if (typeof Ctor === 'function') {
    try {
      next = new Ctor(fundamental, octave, ACCIDENTAL_NONE, undefined, true);
    } catch {
      next = null;
    }
  }
  if (!next) {
    next = { FundamentalNote: fundamental, Octave: octave, __hitlRestDisplay: true };
  }

  try {
    rest.Pitch = next;
    return true;
  } catch {
    /* Pitch is getter-only on OSMD Note — write private field */
  }
  try {
    (rest as { pitch?: unknown }).pitch = next;
    return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * OSMD load 직후 · render 전 — SourceNote.Pitch를 반대편으로 고정.
 * GraphicSheet가 아직 비어 있어도 동작한다.
 */
export function patchOsmdPolyphonicRestVfpitch(osmd: OpenSheetMusicDisplay): number {
  let patched = 0;
  const sheet = asRecord((osmd as unknown as { Sheet?: unknown }).Sheet);
  if (!sheet) return 0;
  const measures = (sheet.SourceMeasures ?? sheet.sourceMeasures ?? []) as unknown[];

  for (const measureRaw of measures) {
    const measure = asRecord(measureRaw);
    if (!measure) continue;
    const containers = (measure.VerticalSourceStaffEntryContainers ??
      measure.verticalSourceStaffEntryContainers ??
      []) as unknown[];

    for (const containerRaw of containers) {
      const container = asRecord(containerRaw);
      if (!container) continue;
      const staffEntries = (container.StaffEntries ?? container.staffEntries ?? []) as unknown[];

      for (const seRaw of staffEntries) {
        const se = asRecord(seRaw);
        if (!se) continue;
        const voiceEntries = (se.VoiceEntries ?? se.voiceEntries ?? []) as unknown[];
        if (voiceEntries.length < 2) continue;

        const pitched: Array<{ note: Record<string, unknown>; dia: number; voice: number | null }> =
          [];
        const rests: Record<string, unknown>[] = [];
        let donorPitch: unknown = null;

        for (const veRaw of voiceEntries) {
          const ve = asRecord(veRaw);
          if (!ve) continue;
          for (const noteRaw of (ve.Notes ?? ve.notes ?? []) as unknown[]) {
            const note = asRecord(noteRaw);
            if (!note) continue;
            if (isRestSourceNote(note)) {
              if (!isWholeOrMeasureRestNote(note)) rests.push(note);
              continue;
            }
            const dia = pitchDiatonicFromSourceNote(note);
            if (dia == null) continue;
            pitched.push({ note, dia, voice: voiceIdFromNote(note) });
            if (!donorPitch) donorPitch = note.Pitch ?? note.pitch;
          }
        }

        if (!rests.length || !pitched.length) continue;
        const kind = clefKindFromStaffEntry(se);
        const mid = middleDiatonic(kind);
        const above = wantRestAbove(
          mid,
          pitched.map((p) => p.dia),
        );
        const spec = restPitchSpec(kind, above);
        for (const rest of rests) {
          if (setRestPitch(rest, donorPitch, spec.fundamental, spec.octave)) patched += 1;
        }
      }
    }
  }

  // render 이후 재호출 시 GraphicalNote.vfpitch도 맞춤
  patched += patchOsmdGraphicRestVfpitch(osmd);
  return patched;
}

function restVfKey(kind: 'G' | 'F' | 'C', wantAbove: boolean): string {
  if (kind === 'F') return wantAbove ? 'an/3' : 'gn/2';
  if (kind === 'C') return wantAbove ? 'gn/4' : 'fn/3';
  return wantAbove ? 'fn/5' : 'en/4';
}

function pitchLabelFromVf(vfpitch: unknown): string | null {
  const raw = Array.isArray(vfpitch) ? vfpitch[0] : vfpitch;
  if (typeof raw !== 'string') return null;
  const m = /^([a-g])([b#]?)n\/(-?\d+)$/i.exec(raw.trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()}${m[2] ?? ''}${m[3]}`;
}

function diatonicFromPitchLabel(label: string): number | null {
  const m = /^([A-G])([b#]?)(-?\d+)$/i.exec(label.trim());
  if (!m) return null;
  const step = STEP_DIATONIC[m[1]!.toUpperCase()];
  if (step == null) return null;
  const oct = parseInt(m[3]!, 10);
  if (!Number.isFinite(oct)) return null;
  return oct * 7 + step;
}

function isRestGraphicNote(gn: Record<string, unknown>): boolean {
  const src = asRecord(gn.sourceNote ?? gn.SourceNote);
  if (!src) return false;
  return isRestSourceNote(src);
}

function clefKindFromGraphic(gn: Record<string, unknown>): 'G' | 'F' | 'C' {
  const fn = gn.Clef;
  let clef: Record<string, unknown> | null = null;
  if (typeof fn === 'function') {
    try {
      clef = asRecord((fn as () => unknown).call(gn));
    } catch {
      clef = null;
    }
  } else {
    clef = asRecord(gn.clef ?? gn.Clef);
  }
  const t = clef?.ClefType ?? clef?.clefType;
  const s = String(t ?? '').toLowerCase();
  if (t === 1 || s === 'f' || s.includes('bass')) return 'F';
  if (t === 2 || s === 'c' || s.includes('alto') || s.includes('tenor')) return 'C';
  return 'G';
}

function patchOsmdGraphicRestVfpitch(osmd: OpenSheetMusicDisplay): number {
  let patched = 0;
  forEachGraphicalMeasure(osmd, (gm) => {
    const entries = (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[];
    for (const seRaw of entries) {
      const se = asRecord(seRaw);
      if (!se) continue;
      const gves = (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[];
      const pitchedDias: number[] = [];
      const rests: Record<string, unknown>[] = [];
      for (const gveRaw of gves) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          if (!gn) continue;
          if (isRestGraphicNote(gn)) {
            rests.push(gn);
            continue;
          }
          const label = pitchLabelFromVf(gn.vfpitch ?? gn.vfPitch);
          const dia = label ? diatonicFromPitchLabel(label) : null;
          if (dia != null) pitchedDias.push(dia);
        }
      }
      if (!rests.length || !pitchedDias.length) continue;
      const kind = clefKindFromGraphic(rests[0]!);
      const above = wantRestAbove(middleDiatonic(kind), pitchedDias);
      const key = restVfKey(kind, above);
      for (const gn of rests) {
        const src = asRecord(gn.sourceNote ?? gn.SourceNote);
        if (src && isWholeOrMeasureRestNote(src)) continue;
        const prev = Array.isArray(gn.vfpitch) ? gn.vfpitch : null;
        gn.vfpitch = [key, undefined, prev?.[2] ?? null];
        if (src && !src.Pitch && !src.pitch) {
          src.Pitch = { __hitlRestDisplay: true };
        }
        patched += 1;
      }
    }
  });
  return patched;
}

function svgUserYFromElement(el: Element, localY: number): number {
  let ty = 0;
  let cur: Element | null = el;
  while (cur) {
    const tr = cur.getAttribute?.('transform') ?? '';
    const tm = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(tr);
    if (tm) ty += parseFloat(tm[2] ?? '0');
    cur = cur.parentElement;
  }
  return ty + localY;
}

function glyphCenterY(stavenote: SVGGraphicsElement, preferRest: boolean): number | null {
  const scope = preferRest
    ? ((stavenote.querySelector('.vf-rest') as SVGGraphicsElement | null) ??
      (stavenote.querySelector('[class*="rest"]') as SVGGraphicsElement | null) ??
      stavenote)
    : stavenote;
  const sel = preferRest ? 'path' : '.vf-notehead path';
  const ys: number[] = [];
  for (const path of scope.querySelectorAll(sel)) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*[-\d.]+\s+([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    ys.push(svgUserYFromElement(path, parseFloat(m[1]!)));
  }
  if (ys.length) return ys.reduce((a, b) => a + b, 0) / ys.length;
  try {
    const box = scope.getBBox();
    if (box && Number.isFinite(box.y)) return svgUserYFromElement(scope, box.y + box.height / 2);
  } catch {
    /* jsdom */
  }
  return null;
}

function stavenoteFromGraphic(
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
      /* ignore */
    }
  }
  candidates.push(gn);
  for (const cand of candidates) {
    const rec = asRecord(cand);
    if (!rec) continue;
    const svgEl = (rec as { getSVGGElement?: () => SVGGraphicsElement | null }).getSVGGElement?.();
    if (!svgEl) continue;
    if (svgEl.classList.contains('vf-stavenote') || svgEl.classList.contains('vf-staveNote')) return svgEl;
    const closest = svgEl.closest('.vf-stavenote, .vf-staveNote') as SVGGraphicsElement | null;
    if (closest) return closest;
  }
  return null;
}

/**
 * render 직후 보조 — 쉼표가 실음과 같은 쪽(아래)에 있으면 SVG Y로 반대편으로 민다.
 */
export function applyOsmdPolyphonicRestOffsets(host: HTMLElement, osmd: OpenSheetMusicDisplay): number {
  void host;
  let shifted = 0;
  forEachGraphicalMeasure(osmd, (gm) => {
    const entries = (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[];
    for (const seRaw of entries) {
      const se = asRecord(seRaw);
      if (!se) continue;
      const gves = (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[];
      const pitchedSvgs: SVGGraphicsElement[] = [];
      const pitchedDias: number[] = [];
      const restSvgs: SVGGraphicsElement[] = [];
      let kind: 'G' | 'F' | 'C' = 'G';
      for (const gveRaw of gves) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          if (!gn) continue;
          const svg = stavenoteFromGraphic(osmd, gn);
          if (!svg) continue;
          if (isRestGraphicNote(gn)) {
            const src = asRecord(gn.sourceNote ?? gn.SourceNote);
            if (src && isWholeOrMeasureRestNote(src)) continue;
            restSvgs.push(svg);
            kind = clefKindFromGraphic(gn);
            continue;
          }
          const label = pitchLabelFromVf(gn.vfpitch ?? gn.vfPitch);
          const dia = label ? diatonicFromPitchLabel(label) : null;
          if (dia != null) pitchedDias.push(dia);
          pitchedSvgs.push(svg);
        }
      }
      if (!restSvgs.length || !pitchedSvgs.length) continue;
      const above = wantRestAbove(middleDiatonic(kind), pitchedDias);
      const noteYs = pitchedSvgs
        .map((s) => glyphCenterY(s, false))
        .filter((y): y is number => y != null && Number.isFinite(y));
      if (!noteYs.length) continue;
      const noteY = noteYs.reduce((a, b) => a + b, 0) / noteYs.length;
      for (const svg of restSvgs) {
        const restY = glyphCenterY(svg, true);
        if (restY == null) continue;
        let delta = 0;
        if (above && restY > noteY - 8) {
          // 실음보다 위로 — 오선 위쪽 칸
          delta = noteY - restY - 36;
        } else if (!above && restY < noteY + 8) {
          delta = noteY - restY + 36;
        } else {
          continue;
        }
        const capped = Math.sign(delta) * Math.min(Math.abs(delta), 56);
        if (Math.abs(capped) < 2) continue;
        applyArticulationShiftY(svg, capped);
        shifted += 1;
      }
    }
  });
  return shifted;
}
