/** HITL articulation & direction 거리 — MusicXML accent, dynamics, words 등 (미리보기·MXL 공통). */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';

export const HITL_ART_DISTANCE_ATTR = 'data-hitl-art-distance';
export const HITL_DIR_DISTANCE_ATTR = 'data-hitl-dir-distance';

/** MusicXML default-y 기본 단위: 오선 1칸(staff space) = 10 tenths = 약 10px. */
export const ARTICULATION_STAFF_GAP_BASE = 10;

export type ArticulationDistanceTier = 'auto' | 'close' | 'far' | 'very-far';

export const COMMON_DISTANCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'auto', label: '보통 (자동 / 1칸)' },
  { value: '1', label: '1칸 (10px)' },
  { value: '2', label: '2칸 (20px)' },
  { value: '3', label: '3칸 (30px)' },
  { value: '4', label: '4칸 (40px)' },
  { value: '5', label: '5칸 (50px)' },
  { value: '6', label: '6칸 (60px)' },
  { value: '7', label: '7칸 (70px)' },
  { value: '8', label: '8칸 (80px)' },
  { value: '9', label: '9칸 (90px)' },
  { value: '10', label: '10칸 (100px)' },
];

export function normalizeArticulationDistanceTier(raw: string | null | undefined): ArticulationDistanceTier | null {
  const d = (raw || '').trim().toLowerCase();
  if (d === 'close' || d === 'far' || d === 'very-far') return d;
  return null;
}

/** preset tier → staff-space 배수 (1칸 = 10 tenths). */
export function articulationTierMultiplier(tier: ArticulationDistanceTier | string | null | undefined): number {
  const t = (tier || '').trim().toLowerCase();
  switch (t) {
    case 'close':
      return 1.0;
    case 'far':
      return 3.0;
    case 'very-far':
      return 5.0;
    case 'auto':
    default:
      return 1.0; // 기본 auto: 음표/기둥 외곽 기준 1칸 (약 10px) 띄움
  }
}

/**
 * distance attr → staff-space 배수.
 * preset(auto/close/far/very-far) 또는 숫자(`1`~`10`, `spaces:5`, `6x`) 지원.
 */
export function parseArticulationStaffSpaces(raw: string | null | undefined): number | null {
  const d = (raw || '').trim().toLowerCase();
  if (!d) return null;
  const tier = normalizeArticulationDistanceTier(d);
  if (tier) return articulationTierMultiplier(tier);
  if (d === 'auto') return articulationTierMultiplier('auto');
  const m = /^(?:spaces?[:x])?(\d+(?:\.\d+)?)$/.exec(d.replace(/\s+/g, ''));
  if (m) {
    const n = parseFloat(m[1]!);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** hint → staff-space 배수 (attr 우선, 없으면 default-y/10, 없으면 auto 배수). */
export function articulationStaffSpacesFromHint(
  distance: string | null | undefined,
  defaultY?: number | null,
): number {
  const fromAttr = parseArticulationStaffSpaces(distance);
  if (fromAttr != null) return fromAttr;
  const mag = Math.abs(defaultY ?? 0);
  if (mag > 0 && mag <= 200) return mag / ARTICULATION_STAFF_GAP_BASE;
  return articulationTierMultiplier('auto');
}

/** MusicXML default-y — placement 방향 × (10 tenths × staff-space 배수). */
export function articulationDefaultYFromStaffSpaces(placement: 'above' | 'below', staffSpaces: number): number {
  const mag = Math.round(ARTICULATION_STAFF_GAP_BASE * staffSpaces);
  return placement === 'below' ? -mag : mag;
}

export function articulationDefaultYFromStaffGap(
  placement: 'above' | 'below',
  tier: ArticulationDistanceTier | null,
): number {
  return articulationDefaultYFromStaffSpaces(placement, articulationTierMultiplier(tier));
}

/** @deprecated */
export function articulationDefaultYForOsmdLoad(
  placement: 'above' | 'below',
  tier: ArticulationDistanceTier | null,
  _hasSlurOnSameSide?: boolean,
): number {
  return articulationDefaultYFromStaffGap(placement, tier);
}

export function articulationShiftMultiplierFromDistance(distance: string | null | undefined): number {
  return articulationStaffSpacesFromHint(distance, null);
}

/** OSMD SVG — staffSpacePx × staff-space 배수. */
export function articulationPreviewShiftPx(staffSpaces: number, staffSpacePx: number): number {
  const space = staffSpacePx > 2 ? staffSpacePx : ARTICULATION_STAFF_GAP_BASE;
  return Math.round(space * staffSpaces);
}

/** UI select value 추정. */
export function articulationDistanceSelectValue(
  distance: string | null | undefined,
  defaultY?: number | null,
): string {
  const d = (distance || '').trim();
  if (d) return d.toLowerCase();
  const spaces = articulationStaffSpacesFromHint(null, defaultY);
  if (Math.abs(spaces - 1) < 0.01) return '1';
  if (Math.abs(spaces - 2) < 0.01) return '2';
  if (Math.abs(spaces - 2.5) < 0.01) return 'auto';
  if (Math.abs(spaces - 3) < 0.01) return '3';
  if (Math.abs(spaces - 4) < 0.01) return '4';
  if (Math.abs(spaces - 5) < 0.01) return '5';
  if (Math.abs(spaces - 6) < 0.01) return '6';
  if (Math.abs(spaces - 7) < 0.01) return '7';
  if (Math.abs(spaces - 8) < 0.01) return '8';
  if (Math.abs(spaces - 9) < 0.01) return '9';
  if (Math.abs(spaces - 10) < 0.01) return '10';
  if (Number.isFinite(spaces) && spaces > 0) {
    return String(Math.round(spaces));
  }
  return 'auto';
}

function xmlLocalName(el: Element): string {
  return typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();
}

export type ArticulationPreviewFix = {
  kind: string;
  partId: string;
  measureMxl: string | number;
  noteIndex?: number;
  articulation?: string;
  placement?: 'above' | 'below' | null;
  distance?: string | null;
};

/**
 * 피치 라벨 비교 (예: "F#4" vs "F#4", "Db4" vs "C#4" 이명동음).
 */
export function pitchLabelsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const na = a.trim().toUpperCase().replace(/♯/g, '#').replace(/♭/g, 'B');
  const nb = b.trim().toUpperCase().replace(/♯/g, '#').replace(/♭/g, 'B');
  if (na === nb) return true;

  const parse = (s: string) => {
    const m = /^([A-G])([#B]*)(\d+)$/.exec(s);
    if (!m) return null;
    const step = m[1]!;
    const acc = m[2]!;
    const oct = parseInt(m[3]!, 10);
    const stepOffset: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let semi = (oct + 1) * 12 + (stepOffset[step] ?? 0);
    for (const ch of acc) {
      if (ch === '#') semi += 1;
      if (ch === 'B') semi -= 1;
    }
    return semi;
  };

  const sa = parse(na);
  const sb = parse(nb);
  if (sa != null && sb != null) return sa === sb;
  return na.replace(/[#B]/g, '') === nb.replace(/[#B]/g, '');
}

export function previewPartIdsMatch(xmlPartId: string, fixPartId: string): boolean {
  if (!xmlPartId || !fixPartId) return false;
  const xBase = xmlPartId.replace(/__PR$|__PL$/, '');
  const fBase = fixPartId.replace(/__PR$|__PL$/, '');
  return (
    xmlPartId === fixPartId ||
    xBase === fBase ||
    fixPartId === `${xBase}__PR` ||
    fixPartId === `${xBase}__PL`
  );
}

export const hitlPreviewPartIdsMatch = previewPartIdsMatch;

function defaultArticulationPlacementFromNote(note: Element): 'above' | 'below' {
  const stem = note.querySelector(':scope > stem, :scope > *|stem')?.textContent?.trim().toLowerCase();
  if (stem === 'up') return 'below';
  if (stem === 'down') return 'above';
  return 'below';
}

function noteHasArticulation(note: Element, articulation: string): boolean {
  const artName = articulation.split('(')[0]!.trim().toLowerCase().replace(/_/g, '-');
  for (const nots of [...note.children].filter((c) => xmlLocalName(c) === 'notations')) {
    for (const arts of [...nots.children].filter((c) => xmlLocalName(c) === 'articulations')) {
      for (const el of [...arts.children]) {
        if (xmlLocalName(el).replace(/_/g, '-') === artName) return true;
      }
    }
  }
  return false;
}

function findNoteForArticulationFix(measure: Element, fix: ArticulationPreviewFix): Element | null {
  const notes = [...measure.children].filter((c) => xmlLocalName(c) === 'note');
  if (!notes.length) return null;
  if (fix.noteIndex != null && notes[fix.noteIndex]) {
    const target = notes[fix.noteIndex]!;
    if (!fix.articulation || noteHasArticulation(target, fix.articulation)) {
      return target;
    }
  }
  if (fix.articulation) {
    for (const note of notes) {
      if (noteHasArticulation(note, fix.articulation)) return note;
    }
  }
  if (fix.noteIndex != null && notes[fix.noteIndex]) return notes[fix.noteIndex]!;
  return null;
}

function applyArticulationAttrsToNote(
  note: Element,
  fix: ArticulationPreviewFix,
): boolean {
  if (!fix.articulation) return false;
  const artName = fix.articulation.split('(')[0]!.trim().toLowerCase().replace(/_/g, '-');
  let changed = false;
  for (const nots of [...note.children].filter((c) => xmlLocalName(c) === 'notations')) {
    for (const arts of [...nots.children].filter((c) => xmlLocalName(c) === 'articulations')) {
      for (const el of [...arts.children]) {
        if (xmlLocalName(el).replace(/_/g, '-') !== artName) continue;
        if (fix.placement === 'above' || fix.placement === 'below') {
          el.setAttribute('placement', fix.placement);
          changed = true;
        }
        if (fix.distance !== undefined) {
          const dist =
            fix.distance == null || fix.distance === '' || fix.distance === 'auto'
              ? null
              : fix.distance.trim().toLowerCase();
          if (dist) el.setAttribute(HITL_ART_DISTANCE_ATTR, dist);
          else el.removeAttribute(HITL_ART_DISTANCE_ATTR);
          changed = true;
        }
        let placement = (el.getAttribute('placement') || '').trim().toLowerCase();
        if (placement !== 'above' && placement !== 'below') {
          placement = defaultArticulationPlacementFromNote(note);
        }
        const effectiveDist = fix.distance !== undefined ? fix.distance : el.getAttribute(HITL_ART_DISTANCE_ATTR);
        const effectiveOldDy = fix.distance !== undefined ? null : (parseInt(el.getAttribute('default-y') ?? '', 10) || null);
        const spaces = articulationStaffSpacesFromHint(effectiveDist, effectiveOldDy);
        const target = String(articulationDefaultYFromStaffSpaces(placement as 'above' | 'below', spaces));
        if (el.getAttribute('default-y') !== target) {
          el.setAttribute('default-y', target);
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** HITL 대기 보정 — articulation 거리/위치를 OSMD 미리보기 XML에 즉시 반영. */
export function applyArticulationPlacementFixesToPreviewXml(
  xml: string,
  fixes: ReadonlyArray<ArticulationPreviewFix>,
): string {
  const artFixes = fixes.filter(
    (f) => f.kind === 'setArticulationPlacement' && f.noteIndex != null && f.articulation,
  );
  if (!artFixes.length) return xml;

  const doc = parseMusicXmlDocument(xml);
  if (!doc) return xml;

  let changed = false;
  const parts = [...doc.documentElement.children].filter((el) => xmlLocalName(el) === 'part');

  for (const fix of artFixes) {
    const part = parts.find((p) => previewPartIdsMatch(p.getAttribute('id')?.trim() ?? '', fix.partId));
    if (!part) continue;
    const measure = [...part.children].find(
      (c) => xmlLocalName(c) === 'measure' && c.getAttribute('number')?.trim() === String(fix.measureMxl),
    );
    if (!measure) continue;
    const note = findNoteForArticulationFix(measure, fix);
    if (!note) continue;
    if (applyArticulationAttrsToNote(note, fix)) changed = true;
  }

  return changed ? serializeMusicXmlDocument(doc) : xml;
}
