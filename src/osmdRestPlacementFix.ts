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
      ? { fundamental: NOTE_ENUM.F, octave: 3 }
      : { fundamental: NOTE_ENUM.B, octave: 2 };
  }
  if (clefKind === 'C') {
    return wantAbove
      ? { fundamental: NOTE_ENUM.E, octave: 4 }
      : { fundamental: NOTE_ENUM.A, octave: 3 };
  }
  return wantAbove
    ? { fundamental: NOTE_ENUM.D, octave: 5 }
    : { fundamental: NOTE_ENUM.G, octave: 4 };
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

    // 마디 전체 실음을 voice별로 — 쉼표 onset에 실음이 없어도 같은 성부 쪽 유지
    const measurePitchedByVoice = new Map<number, number[]>();
    for (const containerRaw of containers) {
      const container = asRecord(containerRaw);
      if (!container) continue;
      for (const seRaw of (container.StaffEntries ?? container.staffEntries ?? []) as unknown[]) {
        const se = asRecord(seRaw);
        if (!se) continue;
        for (const veRaw of (se.VoiceEntries ?? se.voiceEntries ?? []) as unknown[]) {
          const ve = asRecord(veRaw);
          if (!ve) continue;
          for (const noteRaw of (ve.Notes ?? ve.notes ?? []) as unknown[]) {
            const note = asRecord(noteRaw);
            if (!note || isRestSourceNote(note)) continue;
            const dia = pitchDiatonicFromSourceNote(note);
            const voice = voiceIdFromNote(note);
            if (dia == null || voice == null) continue;
            const list = measurePitchedByVoice.get(voice) ?? [];
            list.push(dia);
            measurePitchedByVoice.set(voice, list);
          }
        }
      }
    }

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
        for (const rest of rests) {
          const restVoice = voiceIdFromNote(rest);
          const ownFromContainer = pitched
            .filter((p) => p.voice != null && p.voice === restVoice)
            .map((p) => p.dia);
          const own =
            ownFromContainer.length > 0
              ? ownFromContainer
              : restVoice != null
                ? (measurePitchedByVoice.get(restVoice) ?? [])
                : [];
          const other = pitched.filter((p) => p.voice == null || p.voice !== restVoice).map((p) => p.dia);
          let above: boolean;
          if (own.length > 0 && other.length > 0) {
            const ownAvg = own.reduce((a, b) => a + b, 0) / own.length;
            const otherAvg = other.reduce((a, b) => a + b, 0) / other.length;
            above = ownAvg >= otherAvg;
          } else {
            above = wantRestAbove(mid, other.length ? other : pitched.map((p) => p.dia));
          }
          const donor =
            pitched.find((p) => p.voice != null && p.voice !== restVoice)?.note.Pitch ??
            pitched.find((p) => p.voice != null && p.voice !== restVoice)?.note.pitch ??
            donorPitch;
          const spec = restPitchSpec(kind, above);
          if (setRestPitch(rest, donor, spec.fundamental, spec.octave)) patched += 1;
        }
      }
    }
  }

  // render 이후 재호출 시 GraphicalNote.vfpitch도 맞춤
  patched += patchOsmdGraphicRestVfpitch(osmd);
  return patched;
}

function restVfKey(kind: 'G' | 'F' | 'C', wantAbove: boolean): string {
  if (kind === 'F') return wantAbove ? 'fn/3' : 'bn/2';
  if (kind === 'C') return wantAbove ? 'en/4' : 'an/3';
  return wantAbove ? 'dn/5' : 'gn/4';
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

function restGlyphBounds(stavenote: SVGGraphicsElement): { minY: number; maxY: number; centerY: number } | null {
  const paths = stavenote.querySelectorAll('path');
  const ys: number[] = [];
  for (const p of paths) {
    const d = p.getAttribute('d');
    if (!d) continue;
    const matches = d.matchAll(/[MLCSQTAZ]([-\d.]+)[, ]([-\d.]+)/g);
    for (const m of matches) {
      ys.push(svgUserYFromElement(p, parseFloat(m[2]!)));
    }
  }
  if (!ys.length) return null;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minY, maxY, centerY: (minY + maxY) / 2 };
}

function getMeasureStaveBounds(gm: unknown, host: HTMLElement): { topY: number; bottomY: number } | null {
  const rec = asRecord(gm);
  const sl = asRecord(rec?.ParentStaffLine ?? rec?.parentStaffLine);
  if (!sl) return null;
  const pos = asRecord(sl.PositionAndShape ?? sl.positionAndShape);
  const abs = asRecord(pos?.AbsolutePosition ?? pos?.absolutePosition);
  const top = coordNum(abs?.y);
  if (top == null) return null;

  const expectedTopPx = top * 10;
  const slSvg = callMaybe(sl, 'getSVGGElement') as SVGGraphicsElement | undefined;
  const container = slSvg ?? host;
  const paths = container.querySelectorAll('path');
  const staveYs: number[] = [];
  for (const p of paths) {
    const d = p.getAttribute('d') || '';
    const m = /M\s*[-\d.]+\s+([-\d.]+)\s*L\s*[-\d.]+\s+\1/.exec(d);
    if (m) {
      const y = parseFloat(m[1]!);
      if (y >= expectedTopPx - 6 && y <= expectedTopPx + 46) {
        staveYs.push(y);
      }
    }
  }
  if (staveYs.length >= 5) {
    staveYs.sort((a, b) => a - b);
    return { topY: staveYs[0]!, bottomY: staveYs[staveYs.length - 1]! };
  }
  return { topY: expectedTopPx, bottomY: expectedTopPx + 40 };
}

/**
 * render 직후 보조 — 쉼표가 실음과 같은 쪽에 있으면 반대편으로 밀고,
 * 쉼표가 오선 밖으로 벗어났으면 오선 안쪽(가운데줄~4줄 사이)으로 당긴다.
 */
export function applyOsmdPolyphonicRestOffsets(host: HTMLElement, osmd: OpenSheetMusicDisplay): number {
  let shifted = 0;
  forEachGraphicalMeasure(osmd, (gm) => {
    const staveBounds = getMeasureStaveBounds(gm, host);
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

      // 1) 동시 onset 다성부 실음과의 충돌 회피 shift
      if (restSvgs.length && pitchedSvgs.length) {
        const above = wantRestAbove(middleDiatonic(kind), pitchedDias);
        const noteYs = pitchedSvgs
          .map((s) => glyphCenterY(s, false))
          .filter((y): y is number => y != null && Number.isFinite(y));
        if (noteYs.length) {
          const noteY = noteYs.reduce((a, b) => a + b, 0) / noteYs.length;
          for (const svg of restSvgs) {
            const restY = glyphCenterY(svg, true);
            if (restY == null) continue;
            let delta = 0;
            if (above && restY > noteY - 8) {
              delta = noteY - restY - 24;
            } else if (!above && restY < noteY + 8) {
              delta = noteY - restY + 24;
            } else {
              continue;
            }
            const capped = Math.sign(delta) * Math.min(Math.abs(delta), 48);
            if (Math.abs(capped) >= 2) {
              applyArticulationShiftY(svg, capped);
              shifted += 1;
            }
          }
        }
      }

      // 2) 오선 밖으로 벗어난 쉼표를 오선 안쪽으로 당기기 (Stave Inset Containment)
      if (staveBounds && restSvgs.length) {
        for (const svg of restSvgs) {
          const b = restGlyphBounds(svg);
          if (!b) continue;
          let clampShift = 0;
          if (b.minY < staveBounds.topY + 4) {
            // 맨 윗줄 위로 삐져나온 경우 오선 안쪽으로 당김
            clampShift = (staveBounds.topY + 8) - b.minY;
          } else if (b.maxY > staveBounds.bottomY - 4) {
            // 맨 아랫줄 아래로 삐져나온 경우 오선 안쪽으로 당김
            clampShift = (staveBounds.bottomY - 8) - b.maxY;
          }
          if (Math.abs(clampShift) >= 1) {
            applyArticulationShiftY(svg, clampShift);
            shifted += 1;
          }
        }
      }
    }
  });
  return shifted;
}
