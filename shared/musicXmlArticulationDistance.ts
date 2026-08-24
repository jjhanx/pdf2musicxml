/** HITL articulation 거리 — MusicXML accent 등 (미리보기·MXL 공통). */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';

export const HITL_ART_DISTANCE_ATTR = 'data-hitl-art-distance';

/** MusicXML articulation default-y: 오선 1칸(staff space) = 10 tenths. */
export const ARTICULATION_STAFF_GAP_BASE = 10;

export type ArticulationDistanceTier = 'auto' | 'close' | 'far' | 'very-far';

export function normalizeArticulationDistanceTier(raw: string | null | undefined): ArticulationDistanceTier | null {
  const d = (raw || '').trim().toLowerCase();
  if (d === 'close' || d === 'far' || d === 'very-far') return d;
  return null;
}

/** preset tier → staff-space 배수 (mf Direction default-y=-65 / 6.5칸 참조). */
export function articulationTierMultiplier(tier: ArticulationDistanceTier | null): number {
  const t = tier ?? 'auto';
  if (t === 'very-far') return 6; // mf Direction(-65 tenths = 6.5칸) 수준으로 시원하게 띄움
  if (t === 'far') return 4;
  if (t === 'close') return 1;
  return 2.5; // 기본 auto: 2.5칸 (이음줄/오선 충돌 완전 방지)
}

/**
 * distance attr → staff-space 배수.
 * preset(auto/close/far/very-far) 또는 숫자(`4`, `spaces:5`, `6x`) 지원.
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
  if (mag > 0 && mag <= 150) return mag / ARTICULATION_STAFF_GAP_BASE;
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
  if (spaces === 0.5) return 'close';
  if (spaces === 1) return 'auto';
  if (spaces === 2) return 'far';
  if (spaces === 3) return 'very-far';
  if (Number.isFinite(spaces)) return String(spaces);
  return 'auto';
}

const STEP_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function midiFromPitchLabel(pitch: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(\d+)$/.exec(pitch.trim());
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const acc = m[2] ?? '';
  const oct = parseInt(m[3]!, 10);
  if (!Number.isFinite(oct) || !(step in STEP_SEMITONE)) return null;
  const alter = acc === '#' ? 1 : acc === 'b' ? -1 : 0;
  return (oct + 1) * 12 + STEP_SEMITONE[step]! + alter;
}

export function pitchLabelsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const softB = (p: string) => p.replace(/^Bb(\d+)$/i, 'B$1');
  if (softB(a) === softB(b)) return true;
  const ma = midiFromPitchLabel(a);
  const mb = midiFromPitchLabel(b);
  return ma != null && mb != null && ma === mb;
}

/** @deprecated articulationStaffSpacesFromHint 사용 */
export function articulationTierFromDefaultY(defaultY: number | null | undefined): ArticulationDistanceTier | null {
  const spaces = articulationStaffSpacesFromHint(null, defaultY);
  if (spaces === 0.5) return 'close';
  if (spaces === 1) return 'auto';
  if (spaces === 2) return 'far';
  if (spaces === 3) return 'very-far';
  return null;
}

type ArticulationPreviewFix = {
  kind: string;
  partId: string;
  measureMxl: string;
  noteIndex?: number;
  articulation?: string;
  placement?: string;
  distance?: string;
};

function xmlLocalName(el: Element): string {
  return typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();
}

export function hitlPreviewPartIdsMatch(xmlPartId: string, fixPartId: string): boolean {
  return previewPartIdsMatch(xmlPartId, fixPartId);
}

function previewPartIdsMatch(xmlPartId: string, fixPartId: string): boolean {
  const base = fixPartId.replace(/__PR$|__PL$/, '');
  const xBase = xmlPartId.replace(/__PR$|__PL$/, '');
  return (
    xmlPartId === fixPartId ||
    xmlPartId === base ||
    xBase === base ||
    fixPartId === `${xBase}__PR` ||
    fixPartId === `${xBase}__PL`
  );
}

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
        const spaces = articulationStaffSpacesFromHint(
          el.getAttribute(HITL_ART_DISTANCE_ATTR),
          parseInt(el.getAttribute('default-y') ?? '', 10) || 0,
        );
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
