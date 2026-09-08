import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { articulationStaffSpacesFromHint, HITL_DIR_DISTANCE_ATTR } from '../shared/musicXmlArticulationDistance';
import { HITL_SLUR_DISTANCE_ATTR } from '../shared/musicXmlSlurDistance';

/** OSMD PlacementEnum — 패키지 루트에서 런타임 export 되지 않음 */
const PLACEMENT_ABOVE = 0;
const PLACEMENT_BELOW = 1;
/** OSMD StemDirectionType.Up */
const STEM_UP = 0;

/** 빔과 같은 쪽 이음줄을 오선에서 띄울 칸 수(미리보기 전용). */
export const BEAM_SLUR_CLEARANCE_STAFF_SPACES = 1;

type PointLike = { x: number; y: number };

type BoundingBoxLike = {
  calculateAbsolutePosition(): void;
  AbsolutePosition: PointLike;
  BorderTop: number;
  BorderBottom: number;
};

type GraphicalNoteLike = {
  PositionAndShape: BoundingBoxLike;
};

type NoteWithBeam = {
  NoteBeam?: unknown;
  isRest?: () => boolean;
};

type SlurNoteLike = NoteWithBeam & {
  ParentVoiceEntry: {
    StemDirection: number;
    Notes: NoteWithBeam[];
  };
};

type GraphicalSlurLike = {
  slur?: {
    StartNote?: SlurNoteLike;
    EndNote?: SlurNoteLike;
    PlacementXml?: number;
  };
  placement?: number;
  bezierStartPt: PointLike;
  bezierStartControlPt: PointLike;
  bezierEndControlPt: PointLike;
  bezierEndPt: PointLike;
  /** 빔 이격 보정을 한 번만 적용 (재 render 시 누적 방지) */
  _hitlBeamClearanceApplied?: boolean;
};

function attrFromUnknown(obj: unknown, names: readonly string[], depth = 0, seen = new Set<unknown>()): string | null {
  if (!obj || typeof obj !== 'object' || depth > 3 || seen.has(obj)) return null;
  seen.add(obj);
  const rec = obj as Record<string, unknown>;
  const getAttr = rec.getAttribute;
  if (typeof getAttr === 'function') {
    for (const name of names) {
      try {
        const v = getAttr.call(obj, name);
        if (typeof v === 'string' && v.trim()) return v.trim();
      } catch {
        /* ignore */
      }
    }
  }
  for (const [key, value] of Object.entries(rec)) {
    const keyLow = key.toLowerCase();
    if (names.some((n) => keyLow === n.toLowerCase() || keyLow.endsWith(n.toLowerCase()))) {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
  }
  for (const [key, value] of Object.entries(rec)) {
    const keyLow = key.toLowerCase();
    if (!/(slur|xml|source|node|element)/.test(keyLow)) continue;
    const nested = attrFromUnknown(value, names, depth + 1, seen);
    if (nested) return nested;
  }
  return null;
}

function slurClearanceStaffSpaces(gSlur: GraphicalSlurLike): number {
  const rawDistance = attrFromUnknown(gSlur.slur ?? gSlur, [
    HITL_SLUR_DISTANCE_ATTR,
    HITL_DIR_DISTANCE_ATTR,
    'SlurDistanceXml',
    'DefaultYXml',
    'default-y',
  ]);
  if (!rawDistance) return BEAM_SLUR_CLEARANCE_STAFF_SPACES;
  const numeric = /^-?\d+(?:\.\d+)?$/.test(rawDistance) ? parseFloat(rawDistance) : NaN;
  if (Number.isFinite(numeric) && Math.abs(numeric) >= 10 && Math.abs(numeric) <= 200) {
    return Math.abs(numeric) / 10;
  }
  return articulationStaffSpacesFromHint(rawDistance, null);
}

type GraphicSheetLike = {
  MusicPages: Array<{
    MusicSystems: Array<{
      StaffLines: Array<{ GraphicalSlurs: GraphicalSlurLike[] }>;
    }>;
  }>;
};

function noteheadAnchorY(
  gNote: GraphicalNoteLike,
  placement: number,
  headOffset: number,
): number {
  const bb = gNote.PositionAndShape;
  bb.calculateAbsolutePosition();
  const y = bb.AbsolutePosition.y;
  if (placement === PLACEMENT_BELOW) {
    return y + bb.BorderBottom + headOffset;
  }
  if (placement === PLACEMENT_ABOVE) {
    return y + bb.BorderTop - headOffset;
  }
  return y + bb.BorderBottom + headOffset;
}

function shiftBezierY(
  gSlur: GraphicalSlurLike,
  dyStart: number,
  dyEnd: number,
  dx: number,
): void {
  gSlur.bezierStartPt.y += dyStart;
  gSlur.bezierStartPt.x += dx;
  gSlur.bezierStartControlPt.y += dyStart * 0.88;
  gSlur.bezierStartControlPt.x += dx * 0.55;
  gSlur.bezierEndControlPt.y += dyEnd * 0.88;
  gSlur.bezierEndControlPt.x += dx * 0.55;
  gSlur.bezierEndPt.y += dyEnd;
  gSlur.bezierEndPt.x += dx;
}

function noteOrVoiceIsBeamed(note: SlurNoteLike | undefined): boolean {
  if (!note) return false;
  if (note.NoteBeam != null) return true;
  return (note.ParentVoiceEntry?.Notes ?? []).some((n) => n.NoteBeam != null);
}

/** 이음줄 placement가 줄기(빔) 쪽인지 — AtStems일 때 겹침 후보. */
export function slurPlacementOnStemSide(
  stemDirection: number | undefined,
  placement: number,
): boolean {
  if (stemDirection === STEM_UP) return placement === PLACEMENT_ABOVE;
  if (stemDirection == null) return false;
  return placement === PLACEMENT_BELOW;
}

/** placement 방향으로 오선 N칸 (OSMD y: 아래=+). */
export function beamSlurClearanceDy(
  placement: number,
  unit: number,
  spaces = BEAM_SLUR_CLEARANCE_STAFF_SPACES,
): number {
  const mag = Math.max(0, spaces) * unit;
  return placement === PLACEMENT_ABOVE ? -mag : mag;
}

/**
 * stem-up 2성부 화음 — slur bezier를 XML이 붙인 음(E4 below / G4 above)의 GNote 위치로 재정렬.
 * load() 직후·render() 직전에 호출 (drawSlur가 bezierStartPt 등을 그대로 사용).
 */
export function retargetGraphicalChordSlurBeziers(osmd: OpenSheetMusicDisplay): void {
  const sheet = osmd.GraphicSheet as GraphicSheetLike | undefined;
  if (!sheet?.MusicPages) return;

  const rules = osmd.EngravingRules;
  const unit = (rules as { unit?: number }).unit ?? 10;
  const headOffset = (rules.SlurNoteHeadYOffset ?? 0.136) * unit;
  const headShiftX = -0.42 * unit;

  for (const page of sheet.MusicPages) {
    for (const system of page.MusicSystems) {
      for (const staffLine of system.StaffLines) {
        for (const gSlur of staffLine.GraphicalSlurs) {
          const slur = gSlur.slur;
          const startNote = slur?.StartNote;
          const endNote = slur?.EndNote;
          if (!startNote || !endNote) continue;

          const voiceEntry = startNote.ParentVoiceEntry;
          const pitched = voiceEntry?.Notes
            ? voiceEntry.Notes.filter((n) => !(typeof n.isRest === 'function' && n.isRest()))
            : [];
          const isChord = pitched.length >= 2 && voiceEntry.StemDirection === STEM_UP;
          const endArts = (endNote as unknown as { Articulations?: unknown[] }).Articulations ?? [];
          const startArts = (startNote as unknown as { Articulations?: unknown[] }).Articulations ?? [];
          const hasArticulationConflict = endArts.length > 0 || startArts.length > 0;

          if (!isChord && !hasArticulationConflict) continue;

          const placement = slur.PlacementXml ?? gSlur.placement ?? PLACEMENT_BELOW;
          if (placement !== PLACEMENT_ABOVE && placement !== PLACEMENT_BELOW) continue;

          let gStart: GraphicalNoteLike;
          let gEnd: GraphicalNoteLike;
          try {
            gStart = rules.GNote(startNote as never) as GraphicalNoteLike;
            gEnd = rules.GNote(endNote as never) as GraphicalNoteLike;
          } catch {
            continue;
          }

          const wantStartY = noteheadAnchorY(gStart, placement, headOffset);
          const wantEndY = noteheadAnchorY(gEnd, placement, headOffset);
          const dyStart = wantStartY - gSlur.bezierStartPt.y;
          const dyEnd = wantEndY - gSlur.bezierEndPt.y;

          if (Math.abs(dyStart) < 0.02 && Math.abs(dyEnd) < 0.02) continue;

          shiftBezierY(gSlur, dyStart, dyEnd, headShiftX);
          // 화음 재정렬 후 빔 이격 플래그 초기화 — 아래에서 다시 적용
          gSlur._hitlBeamClearanceApplied = false;
        }
      }
    }
  }
}

/**
 * 빔과 같은 쪽(줄기 쪽) 이음줄을 오선 1칸만큼 밖으로 밀어 겹침을 줄인다.
 * 미리보기 전용(저장 MXL 불변). render() 직전 호출.
 */
export function nudgeGraphicalSlursAwayFromBeams(osmd: OpenSheetMusicDisplay): void {
  const sheet = osmd.GraphicSheet as GraphicSheetLike | undefined;
  if (!sheet?.MusicPages) return;

  const rules = osmd.EngravingRules;
  const unit = (rules as { unit?: number }).unit ?? 10;

  for (const page of sheet.MusicPages) {
    for (const system of page.MusicSystems) {
      for (const staffLine of system.StaffLines) {
        for (const gSlur of staffLine.GraphicalSlurs) {
          if (gSlur._hitlBeamClearanceApplied) continue;
          const slur = gSlur.slur;
          const startNote = slur?.StartNote;
          const endNote = slur?.EndNote;
          if (!startNote || !endNote) continue;
          if (!noteOrVoiceIsBeamed(startNote) && !noteOrVoiceIsBeamed(endNote)) continue;

          const placement = slur.PlacementXml ?? gSlur.placement ?? PLACEMENT_BELOW;
          if (placement !== PLACEMENT_ABOVE && placement !== PLACEMENT_BELOW) continue;

          const stemStart = startNote.ParentVoiceEntry?.StemDirection;
          const stemEnd = endNote.ParentVoiceEntry?.StemDirection;
          const onStemSide =
            slurPlacementOnStemSide(stemStart, placement) ||
            slurPlacementOnStemSide(stemEnd, placement);
          if (!onStemSide) continue;

          const dy = beamSlurClearanceDy(placement, unit, slurClearanceStaffSpaces(gSlur));
          if (Math.abs(dy) < 0.01) continue;
          shiftBezierY(gSlur, dy, dy, 0);
          gSlur._hitlBeamClearanceApplied = true;
        }
      }
    }
  }
}

/** 화음 slur 재정렬 + 빔·이음줄 이격 — render() 직전. */
export function prepareGraphicalSlursForOsmdPreview(osmd: OpenSheetMusicDisplay): void {
  retargetGraphicalChordSlurBeziers(osmd);
  nudgeGraphicalSlursAwayFromBeams(osmd);
}
