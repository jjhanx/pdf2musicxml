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

function voiceEntryTimestamp(gve: Record<string, unknown>): number | null {
  const parent = asRecord(gve.parentVoiceEntry ?? gve.ParentVoiceEntry ?? gve.parentStaffEntry ?? gve.ParentStaffEntry);
  const ts = parent?.Timestamp ?? parent?.timestamp ?? gve.Timestamp ?? gve.timestamp;
  return coordNum(ts);
}

function voiceEntryVoice(gve: Record<string, unknown>): string | null {
  const parent = asRecord(gve.parentVoiceEntry ?? gve.ParentVoiceEntry);
  const voice = parent?.Voice ?? parent?.voice ?? parent?.VoiceId ?? parent?.voiceId;
  if (typeof voice === 'number' && Number.isFinite(voice)) return String(voice);
  if (typeof voice === 'string' && voice.trim()) return voice.trim();
  const notes = (gve.notes ?? gve.Notes) as unknown[] | undefined;
  for (const note of notes ?? []) {
    const src = asRecord(asRecord(note)?.sourceNote ?? asRecord(note)?.SourceNote);
    const vn = src?.Voice ?? src?.voice;
    if (typeof vn === 'number' && Number.isFinite(vn)) return String(vn);
    if (typeof vn === 'string' && vn.trim()) return vn.trim();
  }
  return null;
}

function readGveX(gve: Record<string, unknown>): number | null {
  const pos = asRecord(gve.PositionAndShape ?? gve.positionAndShape);
  const rel = asRecord(pos?.RelativePosition ?? pos?.relativePosition);
  return coordNum(rel?.x ?? rel?.X);
}

function shiftPointLike(pt: Record<string, unknown>, dx: number): void {
  if (typeof pt.x === 'number') pt.x += dx;
  if (typeof pt.X === 'number') pt.X += dx;
}

function shiftPositionAndShape(pos: Record<string, unknown>, dx: number): void {
  const rel = asRecord(pos.RelativePosition ?? pos.relativePosition);
  if (rel) shiftPointLike(rel, dx);
  const abs = asRecord(pos.AbsolutePosition ?? pos.absolutePosition);
  if (abs) shiftPointLike(abs, dx);
}

function shiftGve(gve: Record<string, unknown>, dx: number): void {
  if (Math.abs(dx) < 0.001) return;
  const pos = asRecord(gve.PositionAndShape ?? gve.positionAndShape);
  if (pos) shiftPositionAndShape(pos, dx);
  const beam = asRecord(gve.parentBeam ?? gve.ParentBeam ?? gve.graphicalBeam ?? gve.GraphicalBeam);
  if (beam) {
    const bpos = asRecord(beam.PositionAndShape ?? beam.positionAndShape);
    if (bpos) shiftPositionAndShape(bpos, dx);
  }
  const notes = (gve.notes ?? gve.Notes) as unknown[] | undefined;
  for (const note of notes ?? []) {
    const nr = asRecord(note);
    const npos = asRecord(nr?.PositionAndShape ?? nr?.positionAndShape);
    if (npos) shiftPositionAndShape(npos, dx);
  }
}

/**
 * linkParallelOnsets — OSMD voice column만 벌어진 동시 onset을 anchor x로 맞춤.
 * MusicXML voice·duration·beam은 건드리지 않음. load() 직후·render() 직전 호출.
 */
export function alignLinkedParallelOnsetGraphics(
  osmd: OpenSheetMusicDisplay,
  hints: readonly LinkedParallelOnsetHint[],
): void {
  if (!hints.length) return;
  const sheet = asRecord((osmd as unknown as { Sheet?: unknown }).Sheet);
  const measureLen = coordNum(sheet?.SourceMeasures?.[0]?.Duration?.RealValue) ?? null;

  const byMeasure = new Map<number, LinkedParallelOnsetHint[]>();
  for (const hint of hints) {
    const list = byMeasure.get(hint.measureNumber) ?? [];
    list.push(hint);
    byMeasure.set(hint.measureNumber, list);
  }

  forEachGraphicalMeasure(osmd, (gmRaw) => {
    const gm = asRecord(gmRaw);
    if (!gm) return;
    const mn = measureMxlFromGraphic(gmRaw);
    if (mn == null) return;
    const measureHints = byMeasure.get(mn);
    if (!measureHints?.length) return;

    const hits: Array<{ gve: Record<string, unknown>; voice: string; onset: number; x: number }> = [];
    const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
    for (const entry of entries ?? []) {
      const er = asRecord(entry);
      if (!er) continue;
      const gves = (er.graphicalVoiceEntries ?? er.GraphicalVoiceEntries) as unknown[] | undefined;
      for (const gveRaw of gves ?? []) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        const voice = voiceEntryVoice(gve);
        const onset = voiceEntryTimestamp(gve);
        const x = readGveX(gve);
        if (!voice || onset == null || x == null) continue;
        hits.push({ gve, voice, onset, x });
      }
    }

    for (const hint of measureHints) {
      const onsetTolerance = measureLen != null ? measureLen / 64 : 0.05;
      const matched = hits.filter(
        (h) => hint.memberVoices.includes(h.voice) && Math.abs(h.onset - hint.onset) <= onsetTolerance,
      );
      if (matched.length < 2) continue;
      const anchor = matched.find((h) => h.voice === hint.anchorVoice) ?? matched[0]!;
      const shifted = new Set<unknown>();
      for (const hit of matched) {
        if (hit.gve === anchor.gve) continue;
        if (shifted.has(hit.gve)) continue;
        shifted.add(hit.gve);
        shiftGve(hit.gve, anchor.x - hit.x);
      }
    }
  });
}
