import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  collectOrderedSlurDistanceHintsFromXml,
  type SlurDistanceHint,
} from '../shared/musicXmlSlurDistance';
import { shiftSvgPathAbsoluteYs, staffSpacePxFromHost } from './osmdArticulationOffsetFix';

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
  const roots = [...host.querySelectorAll('.vf-stavetie, .vf-curve, .vf-tie')];
  const candidates = roots.flatMap((root) => [
    ...(root.tagName.toLowerCase() === 'path' ? [root as SVGPathElement] : []),
    ...([...root.querySelectorAll('path')] as SVGPathElement[]),
  ]);
  return candidates.filter((path) => {
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

function elementTranslate(el: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cur: Element | null = el;
  while (cur) {
    const tr = cur.getAttribute?.('transform') ?? '';
    const m = /translate\(\s*([-\d.eE+]+)(?:[\s,]+([-\d.eE+]+))?/.exec(tr);
    if (m) {
      x += parseFloat(m[1]!);
      y += m[2] != null ? parseFloat(m[2]!) : 0;
    }
    cur = cur.parentElement;
  }
  return { x, y };
}

function stemSegmentsFromHost(host: HTMLElement): Array<{ x: number; minY: number; maxY: number }> {
  const out: Array<{ x: number; minY: number; maxY: number }> = [];
  const stems = [...host.querySelectorAll('.vf-stem')];
  for (const stem of stems) {
    for (const path of stem.querySelectorAll('path')) {
      const d = path.getAttribute('d') || '';
      const m = /M\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*L\s*([-\d.eE+]+)\s+([-\d.eE+]+)/i.exec(d);
      if (!m) continue;
      const t = elementTranslate(path);
      const x1 = parseFloat(m[1]!) + t.x;
      const x2 = parseFloat(m[3]!) + t.x;
      const y1 = parseFloat(m[2]!) + t.y;
      const y2 = parseFloat(m[4]!) + t.y;
      if (![x1, x2, y1, y2].every(Number.isFinite)) continue;
      if (Math.abs(y2 - y1) < 4) continue;
      out.push({ x: (x1 + x2) / 2, minY: Math.min(y1, y2), maxY: Math.max(y1, y2) });
    }
    for (const line of stem.querySelectorAll('line')) {
      const x1 = parseFloat(line.getAttribute('x1') ?? '');
      const x2 = parseFloat(line.getAttribute('x2') ?? '');
      const y1 = parseFloat(line.getAttribute('y1') ?? '');
      const y2 = parseFloat(line.getAttribute('y2') ?? '');
      if (![x1, x2, y1, y2].every(Number.isFinite)) continue;
      if (Math.abs(y2 - y1) < 4) continue;
      const t = elementTranslate(line);
      out.push({
        x: (x1 + x2) / 2 + t.x,
        minY: Math.min(y1, y2) + t.y,
        maxY: Math.max(y1, y2) + t.y,
      });
    }
  }
  return out;
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

function svgPathXYValues(d: string): { xs: number[]; ys: number[] } {
  const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < nums.length; i += 2) {
    if (Number.isFinite(nums[i])) xs.push(nums[i]!);
    if (Number.isFinite(nums[i + 1])) ys.push(nums[i + 1]!);
  }
  return { xs, ys };
}

function mapSvgPathAbsoluteXs(d: string, mapX: (x: number) => number): string {
  if (!d) return d;
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens?.length) return d;
  let cmd = '';
  const out: string[] = [];
  let i = 0;
  const num = (): number => {
    const t = tokens[i++];
    return t != null ? parseFloat(t) : NaN;
  };
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/^[a-zA-Z]$/.test(t)) {
      cmd = t;
      out.push(t);
      i += 1;
      continue;
    }
    const c = cmd;
    if (c === 'M' || c === 'L' || c === 'T') {
      out.push(String(mapX(num())), String(num()));
      if (c === 'M') cmd = 'L';
    } else if (c === 'm' || c === 'l' || c === 't') {
      out.push(String(num()), String(num()));
    } else if (c === 'C') {
      out.push(String(mapX(num())), String(num()), String(mapX(num())), String(num()), String(mapX(num())), String(num()));
    } else if (c === 'c') {
      out.push(String(num()), String(num()), String(num()), String(num()), String(num()), String(num()));
    } else if (c === 'Q' || c === 'S') {
      out.push(String(mapX(num())), String(num()), String(mapX(num())), String(num()));
    } else if (c === 'q' || c === 's') {
      out.push(String(num()), String(num()), String(num()), String(num()));
    } else if (c === 'H') {
      out.push(String(mapX(num())));
    } else if (c === 'h') {
      out.push(String(num()));
    } else if (c === 'V' || c === 'v') {
      out.push(String(num()));
    } else if (c === 'A') {
      out.push(String(num()), String(num()), String(num()), String(num()), String(num()), String(mapX(num())), String(num()));
    } else if (c === 'a') {
      out.push(String(num()), String(num()), String(num()), String(num()), String(num()), String(num()), String(num()));
    } else {
      out.push(t);
      i += 1;
    }
  }
  return out.join(' ');
}

function slurStemSpanForPath(
  pathInfo: { minX: number; maxX: number; minY: number; maxY: number },
  stems: Array<{ x: number; minY: number; maxY: number }>,
  staffSpacePx: number,
): { minX: number; maxX: number } | null {
  const verticalLimit = Math.max(24, staffSpacePx * 8);
  const nearby = stems.filter((s) => {
    const dy = Math.max(0, pathInfo.minY - s.maxY, s.minY - pathInfo.maxY);
    return dy <= verticalLimit;
  }).sort((a, b) => a.x - b.x);
  if (nearby.length < 2) return null;
  const rightIdx = nearby.findIndex((s) => s.x >= pathInfo.maxX - staffSpacePx * 0.25);
  if (rightIdx > 0) {
    const left = nearby[rightIdx - 1]!;
    const right = nearby[rightIdx]!;
    if (right.x > left.x + staffSpacePx) {
      return {
        minX: Math.min(pathInfo.minX, left.x),
        maxX: Math.max(pathInfo.maxX, right.x),
      };
    }
  }
  const centerX = (pathInfo.minX + pathInfo.maxX) / 2;
  for (let i = 1; i < nearby.length; i += 1) {
    const left = nearby[i - 1]!;
    const right = nearby[i]!;
    if (right.x <= left.x + staffSpacePx) continue;
    if (centerX >= left.x - staffSpacePx && centerX <= right.x + staffSpacePx) {
      return {
        minX: Math.min(pathInfo.minX, left.x),
        maxX: Math.max(pathInfo.maxX, right.x),
      };
    }
  }
  const left = nearby
    .filter((s) => s.x <= pathInfo.minX + staffSpacePx * 2)
    .sort((a, b) => b.x - a.x)[0];
  const right = nearby
    .filter((s) => s.x >= pathInfo.maxX - staffSpacePx * 2 && (!left || s.x > left.x + staffSpacePx))
    .sort((a, b) => a.x - b.x)[0];
  if (!left || !right || right.x <= left.x + staffSpacePx) return null;
  return {
    minX: Math.min(pathInfo.minX, left.x),
    maxX: Math.max(pathInfo.maxX, right.x),
  };
}

function chooseSlurPathForHint(
  infos: Array<{ path: SVGPathElement; minX: number; maxX: number; minY: number; maxY: number; firstX: number }>,
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

function applySlurSvgShift(path: SVGPathElement, deltaY: number, span?: { minX: number; maxX: number } | null): void {
  const currentD = path.getAttribute('d') || '';
  const lastAppliedD = path.getAttribute('data-hitl-slur-last-d') || '';
  if (!path.hasAttribute('data-hitl-slur-base-d') || (lastAppliedD && currentD !== lastAppliedD)) {
    path.setAttribute('data-hitl-slur-base-d', currentD);
  }
  const baseD = path.getAttribute('data-hitl-slur-base-d') || currentD;
  if (Math.abs(deltaY) < 0.01 && !span) {
    path.setAttribute('d', baseD);
    path.removeAttribute('data-hitl-slur-shift-y');
    path.removeAttribute('data-hitl-slur-last-d');
    path.removeAttribute('data-hitl-slur-span-x');
    return;
  }
  let adjustedD = baseD;
  if (span) {
    const { xs } = svgPathXYValues(baseD);
    const minX = xs.length ? Math.min(...xs) : NaN;
    const maxX = xs.length ? Math.max(...xs) : NaN;
    if (Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX) {
      const targetMinX = Math.min(minX, span.minX);
      const targetMaxX = Math.max(maxX, span.maxX);
      if (targetMaxX - targetMinX > maxX - minX + 0.5) {
        adjustedD = mapSvgPathAbsoluteXs(baseD, (x) => targetMinX + ((x - minX) / (maxX - minX)) * (targetMaxX - targetMinX));
        path.setAttribute('data-hitl-slur-span-x', `${targetMinX},${targetMaxX}`);
      }
    }
  }
  const shiftedD = shiftSvgPathAbsoluteYs(adjustedD, deltaY);
  path.setAttribute('d', shiftedD);
  path.setAttribute('data-hitl-slur-shift-y', String(deltaY));
  path.setAttribute('data-hitl-slur-last-d', shiftedD);
}

/** render 후 SVG path 직접 보정 — OSMD가 slur default-y/bezier 변화를 무시하는 경우의 확정 경로. */
export function applyOsmdSlurDistanceOffsets(host: HTMLElement, osmd: OpenSheetMusicDisplay): number {
  const hints = orderedSlurHintsForOsmd(osmd);
  const hinted = hints
    .map((hint, index) => ({ hint, index }))
    .filter(({ hint }) => !!hint.distance);
  if (!hinted.length) return 0;
  const paths = slurSvgPaths(host);
  if (!paths.length) return 0;
  const infos = paths.map((path) => {
    const d = path.getAttribute('d') || '';
    const { xs, ys } = svgPathXYValues(d);
    const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
    return {
      path,
      minX: xs.length ? Math.min(...xs) : Number.POSITIVE_INFINITY,
      maxX: xs.length ? Math.max(...xs) : Number.NEGATIVE_INFINITY,
      minY: ys.length ? Math.min(...ys) : Number.POSITIVE_INFINITY,
      maxY: ys.length ? Math.max(...ys) : Number.NEGATIVE_INFINITY,
      firstX: Number.isFinite(nums[0]) ? nums[0]! : Number.POSITIVE_INFINITY,
    };
  });
  const graphicalSlurs = orderedGraphicalSlurs(osmd);
  const staffSpacePx = staffSpacePxFromHost(host, osmd) || 10;
  const stems = stemSegmentsFromHost(host);
  let shifted = 0;
  const used = new Set<SVGPathElement>();
  for (const { hint, index } of hinted) {
    const target = graphicalSlurs[index] ? graphicalSlurSummary(graphicalSlurs[index]!) : null;
    const path = chooseSlurPathForHint(infos, used, hint, target);
    if (!path) continue;
    used.add(path);
    const extraSpaces = Math.max(0, hint.staffSpaces - BEAM_SLUR_CLEARANCE_STAFF_SPACES);
    const deltaY = (hint.placement === 'above' ? -1 : 1) * extraSpaces * staffSpacePx;
    const info = infos.find((it) => it.path === path);
    const span = info ? slurStemSpanForPath(info, stems, staffSpacePx) : null;
    applySlurSvgShift(path, deltaY, span);
    if (Math.abs(deltaY) > 0.01 || span) shifted += 1;
  }
  host.setAttribute('data-hitl-slur-shifted', String(shifted));
  return shifted;
}
