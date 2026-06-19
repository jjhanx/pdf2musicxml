import { EngravingRules, OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/** OSMD PlacementEnum — 패키지 루트에서 런타임 export 되지 않음 */
const PLACEMENT_ABOVE = 0;
const PLACEMENT_BELOW = 1;
/** OSMD StemDirectionType.Up */
const STEM_UP = 0;

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
};

type SlurNoteLike = {
  ParentVoiceEntry: {
    StemDirection: number;
    Notes: Array<{ isRest(): boolean }>;
  };
};

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

/**
 * stem-up 2성부 화음 — slur bezier를 XML이 붙인 음(E4 below / G4 above)의 GNote 위치로 재정렬.
 * load() 직후·render() 직전에 호출 (drawSlur가 bezierStartPt 등을 그대로 사용).
 */
export function retargetGraphicalChordSlurBeziers(osmd: OpenSheetMusicDisplay): void {
  const sheet = osmd.GraphicSheet as GraphicSheetLike | undefined;
  if (!sheet?.MusicPages) return;

  const rules = osmd.EngravingRules;
  const unit = EngravingRules.unit ?? 10;
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
          const pitched = voiceEntry.Notes.filter((n) => !n.isRest());
          if (pitched.length < 2) continue;
          if (voiceEntry.StemDirection !== STEM_UP) continue;

          const placement = slur.PlacementXml ?? gSlur.placement ?? PLACEMENT_BELOW;
          if (placement !== PLACEMENT_ABOVE && placement !== PLACEMENT_BELOW) continue;

          let gStart: GraphicalNoteLike;
          let gEnd: GraphicalNoteLike;
          try {
            gStart = rules.GNote(startNote) as GraphicalNoteLike;
            gEnd = rules.GNote(endNote) as GraphicalNoteLike;
          } catch {
            continue;
          }

          const wantStartY = noteheadAnchorY(gStart, placement, headOffset);
          const wantEndY = noteheadAnchorY(gEnd, placement, headOffset);
          const dyStart = wantStartY - gSlur.bezierStartPt.y;
          const dyEnd = wantEndY - gSlur.bezierEndPt.y;

          if (Math.abs(dyStart) < 0.02 && Math.abs(dyEnd) < 0.02) continue;

          shiftBezierY(gSlur, dyStart, dyEnd, headShiftX);
        }
      }
    }
  }
}
