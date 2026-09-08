import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  collectOrderedSlurDistanceHintsFromXml,
  type SlurDistanceHint,
} from '../shared/musicXmlSlurDistance';
import { shiftSvgPathAbsoluteYs } from './osmdArticulationOffsetFix';

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
  _hitlBeamClearanceSpacesApplied?: number;
};

const slurPreviewXmlByOsmd = new WeakMap<OpenSheetMusicDisplay, string>();
const slurHintsByXml = new Map<string, SlurDistanceHint[]>();

export function registerOsmdPreviewXmlForSlurs(osmd: OpenSheetMusicDisplay, xml: string): void {
  slurPreviewXmlByOsmd.set(osmd, xml);
}

function orderedSlurHintsForOsmd(osmd: OpenSheetMusicDisplay): SlurDistanceHint[] {
  const xml = slurPreviewXmlByOsmd.get(osmd);
  if (!xml?.trim()) return [];
  const cached = slurHintsByXml.get(xml);
  if (cached) return cached;
  const hints = collectOrderedSlurDistanceHintsFromXml(xml);
  if (slurHintsByXml.size > 20) slurHintsByXml.clear();
  slurHintsByXml.set(xml, hints);
  return hints;
}

function slurClearanceStaffSpaces(_gSlur: GraphicalSlurLike): number {
  // User-selected distance is applied after render to SVG paths. This pre-render path
  // keeps only the legacy automatic 1-space beam clearance.
  return BEAM_SLUR_CLEARANCE_STAFF_SPACES;
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
          gSlur._hitlBeamClearanceSpacesApplied = 0;
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

          const desiredSpaces = slurClearanceStaffSpaces(gSlur);
          const previousSpaces = gSlur._hitlBeamClearanceApplied ? (gSlur._hitlBeamClearanceSpacesApplied ?? 0) : 0;
          const dy = beamSlurClearanceDy(placement, unit, desiredSpaces) - beamSlurClearanceDy(placement, unit, previousSpaces);
          if (Math.abs(dy) < 0.01) continue;
          shiftBezierY(gSlur, dy, dy, 0);
          gSlur._hitlBeamClearanceApplied = true;
          gSlur._hitlBeamClearanceSpacesApplied = desiredSpaces;
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

function slurSvgPaths(host: HTMLElement): SVGPathElement[] {
  return ([...host.querySelectorAll('path')] as SVGPathElement[]).filter((path) => {
    const d = path.getAttribute('d') || '';
    if (!/[CQ]/.test(d)) return false;
    const groupClass = [
      path.getAttribute('class') || '',
      path.parentElement?.getAttribute('class') || '',
      path.closest('.vf-stavetie,.vf-curve,.vf-tie')?.getAttribute('class') || '',
    ].join(' ');
    return /vf-stavetie|vf-curve|vf-tie/i.test(groupClass);
  });
}

function orderedGraphicalSlurs(osmd: OpenSheetMusicDisplay): GraphicalSlurLike[] {
  const sheet = (osmd.GraphicSheet ?? (osmd as unknown as { graphic?: { sheet?: GraphicSheetLike } }).graphic?.sheet) as
    | GraphicSheetLike
    | undefined;
  if (!sheet?.MusicPages) return [];
  const out: GraphicalSlurLike[] = [];
  for (const page of sheet.MusicPages) {
    for (const system of page.MusicSystems) {
      for (const staffLine of system.StaffLines) {
        out.push(...staffLine.GraphicalSlurs);
      }
    }
  }
  return out;
}

function graphicalSlurSummary(gSlur: GraphicalSlurLike): { minY: number; maxY: number; firstX: number } | null {
  const points = [
    gSlur.bezierStartPt,
    gSlur.bezierStartControlPt,
    gSlur.bezierEndControlPt,
    gSlur.bezierEndPt,
  ].filter((p): p is GraphicalPoint => !!p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!points.length) return null;
  return {
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
    firstX: points[0]?.x ?? Number.POSITIVE_INFINITY,
  };
}

function svgPathYValues(d: string): number[] {
  const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const ys: number[] = [];
  for (let i = 1; i < nums.length; i += 2) ys.push(nums[i]!);
  return ys.filter(Number.isFinite);
}

function chooseSlurPathForHint(
  infos: Array<{ path: SVGPathElement; minY: number; maxY: number; firstX: number }>,
  used: Set<SVGPathElement>,
  hint: SlurDistanceHint,
  target?: { minY: number; maxY: number; firstX: number } | null,
): SVGPathElement | null {
  const remaining = infos.filter((info) => !used.has(info.path));
  if (!remaining.length) return null;
  if (target) {
    const sorted = [...remaining].sort((a, b) => {
      const da = Math.abs(a.minY - target.minY) + Math.abs(a.maxY - target.maxY) + Math.abs(a.firstX - target.firstX) * 0.1;
      const db = Math.abs(b.minY - target.minY) + Math.abs(b.maxY - target.maxY) + Math.abs(b.firstX - target.firstX) * 0.1;
      return da - db;
    });
    return sorted[0]?.path ?? null;
  }
  const sorted = [...remaining].sort((a, b) => {
    const primary = hint.placement === 'above' ? a.minY - b.minY : b.maxY - a.maxY;
    return Math.abs(primary) > 0.01 ? primary : a.firstX - b.firstX;
  });
  return sorted[0]?.path ?? null;
}

function applySlurSvgShift(path: SVGPathElement, deltaY: number): void {
  if (!path.hasAttribute('data-hitl-slur-base-d')) {
    path.setAttribute('data-hitl-slur-base-d', path.getAttribute('d') || '');
  }
  const baseD = path.getAttribute('data-hitl-slur-base-d') || path.getAttribute('d') || '';
  if (Math.abs(deltaY) < 0.01) {
    path.setAttribute('d', baseD);
    path.removeAttribute('data-hitl-slur-shift-y');
    return;
  }
  path.setAttribute('d', shiftSvgPathAbsoluteYs(baseD, deltaY));
  path.setAttribute('data-hitl-slur-shift-y', String(deltaY));
}

/** render 후 SVG path 직접 보정 — OSMD가 slur default-y/bezier 변화를 무시하는 경우의 확정 경로. */
export function applyOsmdSlurDistanceOffsets(host: HTMLElement, osmd: OpenSheetMusicDisplay): number {
  const hints = orderedSlurHintsForOsmd(osmd);
  if (!hints.length) return 0;
  const paths = slurSvgPaths(host);
  if (!paths.length) return 0;
  const infos = paths.map((path) => {
    const d = path.getAttribute('d') || '';
    const ys = svgPathYValues(d);
    const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
    return {
      path,
      minY: ys.length ? Math.min(...ys) : Number.POSITIVE_INFINITY,
      maxY: ys.length ? Math.max(...ys) : Number.NEGATIVE_INFINITY,
      firstX: Number.isFinite(nums[0]) ? nums[0]! : Number.POSITIVE_INFINITY,
    };
  });
  const graphicalSlurs = orderedGraphicalSlurs(osmd);
  const unit = ((osmd.EngravingRules as unknown as { unit?: number }).unit ?? 10) || 10;
  let shifted = 0;
  const used = new Set<SVGPathElement>();
  for (let i = 0; i < hints.length; i += 1) {
    const hint = hints[i]!;
    const target = graphicalSlurs[i] ? graphicalSlurSummary(graphicalSlurs[i]!) : null;
    const path = chooseSlurPathForHint(infos, used, hint, target);
    if (!path) continue;
    used.add(path);
    if (!hint.distance) {
      applySlurSvgShift(path, 0);
      continue;
    }
    const extraSpaces = Math.max(0, hint.staffSpaces - BEAM_SLUR_CLEARANCE_STAFF_SPACES);
    const deltaY = (hint.placement === 'above' ? -1 : 1) * extraSpaces * unit;
    applySlurSvgShift(path, deltaY);
    if (Math.abs(deltaY) > 0.01) shifted += 1;
  }
  host.setAttribute('data-hitl-slur-shifted', String(shifted));
  return shifted;
}
