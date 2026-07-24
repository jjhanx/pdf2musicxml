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

function sourceVoiceId(ve: Record<string, unknown>): string | null {
  const pv = asRecord(ve.ParentVoice ?? ve.parentVoice);
  const id = pv?.VoiceId ?? pv?.voiceId ?? ve.voiceId ?? ve.VoiceId;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  if (typeof id === 'string' && id.trim()) return id.trim();
  return null;
}

function measureNumberFromSourceMeasure(sm: Record<string, unknown>): number | null {
  for (const key of ['MeasureNumberXML', 'measureNumberXML', 'MeasureNumber', 'measureNumber']) {
    const n = Number(sm[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isRestNote(note: Record<string, unknown>): boolean {
  if (typeof note.isRest === 'function') {
    try {
      return (note.isRest as () => boolean)();
    } catch {
      /* ignore */
    }
  }
  return note.isRest === true || note.IsRest === true;
}

function readGraphicCenterX(
  gn: Record<string, unknown>,
  svg: SVGGraphicsElement | null | undefined,
  host: HTMLElement | null,
): number | null {
  if (svg && host) {
    try {
      const hostRect = host.getBoundingClientRect();
      const noteRect = svg.getBoundingClientRect();
      if (noteRect.width > 0 || noteRect.height > 0) {
        return noteRect.left + noteRect.width / 2 - hostRect.left;
      }
    } catch {
      /* ignore */
    }
  }
  if (svg?.getBBox) {
    try {
      const bb = svg.getBBox();
      if (Number.isFinite(bb.width)) return bb.x + bb.width / 2;
    } catch {
      /* ignore */
    }
  }
  const pos = asRecord(gn.PositionAndShape ?? gn.positionAndShape);
  if (pos) {
    if (typeof pos.calculateAbsolutePosition === 'function') {
      try {
        (pos.calculateAbsolutePosition as () => void)();
      } catch {
        /* ignore */
      }
    }
    const abs = asRecord(pos.AbsolutePosition ?? pos.absolutePosition);
    const x = coordNum(abs?.x ?? abs?.X);
    if (x != null) return x;
  }
  return null;
}

function applySvgTranslateX(svg: SVGGraphicsElement, dx: number): void {
  if (Math.abs(dx) < 0.25) return;
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
  svg: SVGGraphicsElement;
  centerX: number;
};

function collectNoteTargetsFromSource(
  osmd: OpenSheetMusicDisplay,
  hint: LinkedParallelOnsetHint,
  host: HTMLElement | null,
): NoteTarget[] {
  const rules = osmd.EngravingRules as { GNote: (note: unknown) => Record<string, unknown> };
  const sheet = asRecord((osmd as unknown as { Sheet?: unknown }).Sheet);
  const sms = sheet?.SourceMeasures as unknown[] | undefined;
  if (!sms?.length) return [];

  const targetTs = osmdTimestampFromLinkedParallelHint(hint);
  const tol = onsetTolerance(hint);
  const out: NoteTarget[] = [];

  for (const smRaw of sms) {
    const sm = asRecord(smRaw);
    if (!sm || measureNumberFromSourceMeasure(sm) !== hint.measureNumber) continue;

    for (const vcRaw of (sm.VerticalSourceStaffEntryContainers ??
      sm.verticalSourceStaffEntryContainers ??
      []) as unknown[]) {
      const vc = asRecord(vcRaw);
      if (!vc) continue;
      const ts = coordNum(vc.Timestamp ?? vc.timestamp);
      if (ts == null || Math.abs(ts - targetTs) > tol) continue;

      for (const seRaw of (vc.StaffEntries ?? vc.staffEntries ?? []) as unknown[]) {
        const se = asRecord(seRaw);
        if (!se) continue;
        for (const veRaw of (se.VoiceEntries ?? se.voiceEntries ?? []) as unknown[]) {
          const ve = asRecord(veRaw);
          if (!ve) continue;
          const voice = sourceVoiceId(ve);
          if (!voice || !hint.memberVoices.includes(voice)) continue;

          for (const noteRaw of (ve.Notes ?? ve.notes ?? []) as unknown[]) {
            const note = asRecord(noteRaw);
            if (!note || isRestNote(note)) continue;
            const gn = rules.GNote(noteRaw);
            const svg = (gn as { getSVGGElement?: () => SVGGraphicsElement | null }).getSVGGElement?.();
            if (!svg) continue;
            const centerX = readGraphicCenterX(gn, svg, host);
            if (centerX == null) continue;
            out.push({ voice, svg, centerX });
          }
        }
      }
    }
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function shiftGraphicVoiceEntries(
  osmd: OpenSheetMusicDisplay,
  hint: LinkedParallelOnsetHint,
  dxByVoice: Map<string, number>,
): void {
  if (!dxByVoice.size) return;
  const targetTs = osmdTimestampFromLinkedParallelHint(hint);
  const tol = onsetTolerance(hint);

  const shiftPoint = (pt: Record<string, unknown>, dx: number) => {
    if (typeof pt.x === 'number') pt.x += dx;
    if (typeof pt.X === 'number') pt.X += dx;
  };
  const shiftPos = (pos: Record<string, unknown>, dx: number) => {
    const rel = asRecord(pos.RelativePosition ?? pos.relativePosition);
    if (rel) shiftPoint(rel, dx);
    const abs = asRecord(pos.AbsolutePosition ?? pos.absolutePosition);
    if (abs) shiftPoint(abs, dx);
  };

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
        const notes = (gve.notes ?? gve.Notes) as unknown[] | undefined;
        let voice: string | null = null;
        for (const note of notes ?? []) {
          const src = asRecord(asRecord(note)?.sourceNote ?? asRecord(note)?.SourceNote);
          const vn = src?.Voice ?? src?.voice;
          if (typeof vn === 'number') voice = String(vn);
          else if (typeof vn === 'string' && vn.trim()) voice = vn.trim();
        }
        if (!voice) continue;
        const dx = dxByVoice.get(voice);
        if (dx == null || Math.abs(dx) < 0.001) continue;
        const pos = asRecord(gve.PositionAndShape ?? gve.positionAndShape);
        if (pos) shiftPos(pos, dx);
      }
    }
  });
}

/**
 * linkParallelOnsets — OSMD voice column만 벌어진 동시 onset을 anchor x로 맞춤.
 * MusicXML voice·duration·beam은 건드리지 않음. render() 직후·host 기준 SVG translate.
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
    const targets = collectNoteTargetsFromSource(osmd, hint, hostEl);
    if (targets.length < 2) continue;

    const byVoice = new Map<string, number[]>();
    for (const t of targets) {
      const list = byVoice.get(t.voice) ?? [];
      list.push(t.centerX);
      byVoice.set(t.voice, list);
    }

    const anchorXs = byVoice.get(hint.anchorVoice);
    const anchorX = anchorXs ? median(anchorXs) : median(targets.map((t) => t.centerX));
    if (!Number.isFinite(anchorX)) continue;

    const dxByVoice = new Map<string, number>();
    for (const t of targets) {
      if (t.voice === hint.anchorVoice) continue;
      const dx = anchorX - t.centerX;
      if (Math.abs(dx) < 0.25) continue;
      applySvgTranslateX(t.svg, dx);
      const prev = dxByVoice.get(t.voice) ?? 0;
      if (Math.abs(dx) > Math.abs(prev)) dxByVoice.set(t.voice, dx);
    }
    shiftGraphicVoiceEntries(osmd, hint, dxByVoice);
  }
}
