import {
  EngravingRules,
  GraphicalSlur,
  OpenSheetMusicDisplay,
  PlacementEnum,
  StemDirectionType,
} from 'opensheetmusicdisplay';

type OsmdWithGraphic = OpenSheetMusicDisplay & {
  graphic?: {
    MusicPages: Array<{
      MusicSystems: Array<{
        StaffLines: Array<{ GraphicalSlurs: GraphicalSlur[] }>;
      }>;
    }>;
  };
};

/** stem-up 화음 — OSMD가 깃대 끝(VoiceEntry bbox)에 붙이는 dual slur를 음머리 쪽으로 이동 */
export function repositionStemUpChordSlurs(osmd: OpenSheetMusicDisplay): void {
  const graphic = (osmd as OsmdWithGraphic).graphic;
  if (!graphic) return;

  const rules = osmd.EngravingRules;
  const unitPx = (EngravingRules.unit ?? 10) * osmd.zoom;
  const stemShift = (rules.IdealStemLength ?? 3.5) * unitPx;
  const headShiftX = -0.55 * unitPx;

  for (const page of graphic.MusicPages) {
    for (const system of page.MusicSystems) {
      for (const staffLine of system.StaffLines) {
        for (const gSlur of staffLine.GraphicalSlurs) {
          const startNote = gSlur.slur?.StartNote;
          if (!startNote) continue;
          const voiceEntry = startNote.ParentVoiceEntry;
          const pitched = voiceEntry.Notes.filter((n) => !n.isRest());
          if (pitched.length < 2) continue;
          if (voiceEntry.StemDirection !== StemDirectionType.Up) continue;

          const placement = gSlur.slur.PlacementXml ?? gSlur.placement;
          let dy = 0;
          let dx = 0;
          if (placement === PlacementEnum.Above) {
            dy = stemShift;
            dx = headShiftX;
          } else if (placement === PlacementEnum.Below) {
            dy = 0.25 * unitPx;
            dx = headShiftX * 0.5;
          } else {
            continue;
          }

          const el = gSlur.SVGElement as SVGElement | undefined;
          if (!el || !(el instanceof SVGElement)) continue;
          const prev = el.getAttribute('transform')?.trim();
          const move = `translate(${dx.toFixed(2)}, ${dy.toFixed(2)})`;
          el.setAttribute('transform', prev ? `${prev} ${move}` : move);
        }
      }
    }
  }
}
