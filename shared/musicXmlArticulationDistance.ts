/** HITL articulation & direction 거리 — MusicXML accent, dynamics, words 등 (미리보기·MXL 공통). */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';

export const HITL_ART_DISTANCE_ATTR = 'data-hitl-art-distance';
export const HITL_DIR_DISTANCE_ATTR = 'data-hitl-dir-distance';

/** MusicXML default-y 기본 단위: 오선 1칸(staff space) = 10 tenths = 약 10px. */
export const ARTICULATION_STAFF_GAP_BASE = 10;

/**
 * OSMD UnknownExpression(words) 기본 Y — 셈여림(mf)과 같이 오선에서 약 4칸 밖.
 * 들어 올린 Accent의 1칸(보통)은 오선/음표 근처이므로, SVG extraY는 이 기준에서 (칸−4)만큼 당기거나 민다.
 */
export const OSMD_WORDS_EXPRESSION_BASELINE_SPACES = 4;

/** 들어 올린 Accent — OSMD 기본 위치 대비 추가 칸(음수면 오선 쪽). */
export function extraLiftedArticulationStaffSpaces(staffSpaces: number): number {
  const n = Number.isFinite(staffSpaces) && staffSpaces > 0 ? staffSpaces : 1;
  return n - OSMD_WORDS_EXPRESSION_BASELINE_SPACES;
}

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
  staffWithinPart?: number | null;
  staff?: number | null;
  articulation?: string;
  placement?: 'above' | 'below' | null;
  distance?: string | null;
  pitchStep?: string;
  pitchOctave?: number;
  pitchAlter?: number;
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

function noteStaffNumber(note: Element): number {
  const st = note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim();
  return st && /^\d+$/.test(st) ? parseInt(st, 10) : 1;
}

function notePitchLabel(note: Element): string | null {
  const pitch = note.querySelector(':scope > pitch, :scope > *|pitch');
  if (!pitch) return null;
  const step = pitch.querySelector('step, *|step')?.textContent?.trim()?.toUpperCase();
  const oct = pitch.querySelector('octave, *|octave')?.textContent?.trim();
  if (!step || !oct) return null;
  const alterRaw = pitch.querySelector('alter, *|alter')?.textContent?.trim();
  const alter = alterRaw ? parseInt(alterRaw, 10) : 0;
  const acc = alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
  return `${step}${acc}${oct}`;
}

export function pitchLabelFromArticulationFix(fix: ArticulationPreviewFix): string | null {
  const step = fix.pitchStep?.trim().toUpperCase().replace(/♯/g, '#').replace(/♭/g, 'B');
  if (!step || fix.pitchOctave == null) return null;
  const alter = fix.pitchAlter ?? 0;
  const acc = alter === 1 ? '#' : alter === -1 ? 'b' : alter === 2 ? '##' : alter === -2 ? 'bb' : '';
  const stepLetter = step.charAt(0);
  return `${stepLetter}${acc}${fix.pitchOctave}`;
}

function findNoteForArticulationFix(measure: Element, fix: ArticulationPreviewFix): Element | null {
  const notes = [...measure.children].filter((c) => xmlLocalName(c) === 'note');
  if (!notes.length) return null;
  const art = fix.articulation;
  const wantPitch = pitchLabelFromArticulationFix(fix);
  const staffW = fix.staffWithinPart ?? fix.staff ?? null;
  const matchesArt = (n: Element) => !art || noteHasArticulation(n, art);
  const matchesPitch = (n: Element) => !wantPitch || pitchLabelsMatch(notePitchLabel(n), wantPitch);
  const matchesStaff = (n: Element) => staffW == null || noteStaffNumber(n) === staffW;

  // 피치(+표) — PR/PL 분할·스태프 필터 후에도 편집기 noteIndex와 무관하게 같은 음표를 찾음
  if (wantPitch && art) {
    const hits = notes.filter((n) => matchesArt(n) && matchesPitch(n) && matchesStaff(n));
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) return hits[0]!;
    const anyPitch = notes.filter((n) => matchesArt(n) && matchesPitch(n));
    if (anyPitch[0]) return anyPitch[0]!;
  }

  // 분할 전 part의 document-order noteIndex (마디 편집기와 동일)
  if (fix.noteIndex != null && notes[fix.noteIndex]) {
    const target = notes[fix.noteIndex]!;
    if (matchesArt(target) && matchesPitch(target)) return target;
  }

  if (art) {
    const staffNotes = notes.filter(matchesStaff);
    for (const note of staffNotes) {
      if (noteHasArticulation(note, art) && matchesPitch(note)) return note;
    }
    for (const note of notes) {
      if (noteHasArticulation(note, art) && matchesPitch(note)) return note;
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
  const doc = note.ownerDocument;
  const artName = fix.articulation.split('(')[0]!.trim().toLowerCase().replace(/_/g, '-');

  // notations 및 articulations 태그 찾기 또는 생성
  let nots = [...note.children].find((c) => xmlLocalName(c) === 'notations');
  if (!nots && doc) {
    nots = doc.createElement('notations');
    note.appendChild(nots);
  }
  if (!nots) return false;

  let arts = [...nots.children].find((c) => xmlLocalName(c) === 'articulations');
  if (!arts && doc) {
    arts = doc.createElement('articulations');
    nots.appendChild(arts);
  }
  if (!arts) return false;

  let artEl = [...arts.children].find((c) => xmlLocalName(c).replace(/_/g, '-') === artName);
  if (!artEl && doc) {
    artEl = doc.createElement(artName);
    arts.appendChild(artEl);
  }
  if (!artEl) return false;

  let changed = false;
  let placement = fix.placement || artEl.getAttribute('placement') || defaultArticulationPlacementFromNote(note);
  if (artEl.getAttribute('placement') !== placement) {
    artEl.setAttribute('placement', placement);
    changed = true;
  }

  const dist = fix.distance == null || fix.distance === '' || fix.distance === 'auto'
    ? null
    : fix.distance.trim().toLowerCase();

  if (dist) {
    if (artEl.getAttribute(HITL_ART_DISTANCE_ATTR) !== dist) {
      artEl.setAttribute(HITL_ART_DISTANCE_ATTR, dist);
      changed = true;
    }
  } else {
    if (artEl.hasAttribute(HITL_ART_DISTANCE_ATTR)) {
      artEl.removeAttribute(HITL_ART_DISTANCE_ATTR);
      changed = true;
    }
  }

  const effectiveDist = dist ?? artEl.getAttribute(HITL_ART_DISTANCE_ATTR);
  const effectiveOldDy = dist ? null : (parseInt(artEl.getAttribute('default-y') ?? '', 10) || null);
  const spaces = articulationStaffSpacesFromHint(effectiveDist, effectiveOldDy);
  const targetDy = String(articulationDefaultYFromStaffSpaces(placement as 'above' | 'below', spaces));
  if (artEl.getAttribute('default-y') !== targetDy) {
    artEl.setAttribute('default-y', targetDy);
    changed = true;
  }

  return changed;
}

/** HITL 대기 보정 — articulation 거리/위치를 OSMD 미리보기 XML에 즉시 반영. */
export function applyArticulationPlacementFixesToPreviewXml(
  xml: string,
  fixes: ReadonlyArray<ArticulationPreviewFix>,
): string {
  const artFixes = fixes.filter(
    (f) =>
      (f.kind === 'setArticulationPlacement' || f.kind === 'addArticulation') &&
      Boolean(f.articulation),
  );
  if (!artFixes.length) return xml;

  const doc = parseMusicXmlDocument(xml);
  if (!doc) return xml;

  let changed = false;
  const parts = [...doc.documentElement.children].filter((el) => xmlLocalName(el) === 'part');

  for (const fix of artFixes) {
    const matchingParts = parts.filter((p) =>
      previewPartIdsMatch(p.getAttribute('id')?.trim() ?? '', fix.partId),
    );
    const targetMxl = String(fix.measureMxl ?? (fix as { measure?: unknown }).measure ?? '').trim();
    for (const part of matchingParts) {
      const measure = [...part.children].find(
        (c) => xmlLocalName(c) === 'measure' && (c.getAttribute('number')?.trim() === targetMxl || targetMxl === ''),
      );
      if (!measure) continue;
      const note = findNoteForArticulationFix(measure, fix);
      if (!note) continue;
      if (applyArticulationAttrsToNote(note, fix)) changed = true;
    }
  }

  return changed ? serializeMusicXmlDocument(doc) : xml;
}

/** OSMD 미리보기 전용 — VexFlow Articulation은 default-y를 무시하므로 Accent 등을 mf처럼 direction으로 올린다. */
export const HITL_LIFTED_ART_ATTR = 'data-hitl-lifted-articulation';

const LIFT_ARTICULATION_GLYPH: Record<string, string> = {
  accent: '>',
  'strong-accent': '^',
  marcato: '^',
  staccato: '·',
  staccatissimo: '▾',
  tenuto: '–',
  'detached-legato': '–·',
  spiccato: '·',
  'breath-mark': ',',
  caesura: '//',
};

const LIFT_ARTICULATION_TAGS = new Set(Object.keys(LIFT_ARTICULATION_GLYPH));
const LIFT_ARTICULATION_GLYPH_SET = new Set(Object.values(LIFT_ARTICULATION_GLYPH));

export function isLiftedArticulationGlyph(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  return LIFT_ARTICULATION_GLYPH_SET.has(t);
}

/**
 * HITL/OSMD 미리보기 전용.
 * `<notations><articulations><accent default-y …>` → 음표 직전 `<direction default-y>` + words 글리프.
 * 저장 MXL은 바꾸지 않음(미리보기 XML에만 적용). OSMD는 direction default-y를 오선 좌표로 씀.
 */
export function liftArticulationsToDirectionsForOsmdPreview(xml: string): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return xml;

  let changed = false;
  const parts = [...doc.documentElement.children].filter((el) => xmlLocalName(el) === 'part');
  for (const part of parts) {
    for (const measure of [...part.children].filter((c) => xmlLocalName(c) === 'measure')) {
      for (const note of [...measure.children].filter((c) => xmlLocalName(c) === 'note')) {
        if (note.querySelector(':scope > rest, :scope > *|rest')) continue;
        const staffText =
          note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() || '1';
        const voiceText =
          note.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || '';

        for (const nots of [...note.children].filter((c) => xmlLocalName(c) === 'notations')) {
          for (const arts of [...nots.children].filter((c) => xmlLocalName(c) === 'articulations')) {
            const toLift = [...arts.children].filter((el) =>
              LIFT_ARTICULATION_TAGS.has(xmlLocalName(el).replace(/_/g, '-')),
            );
            if (!toLift.length) continue;
            for (const artEl of toLift) {
              const tag = xmlLocalName(artEl).replace(/_/g, '-');
              let placement = (artEl.getAttribute('placement') || '').trim().toLowerCase();
              if (placement !== 'above' && placement !== 'below') {
                placement = defaultArticulationPlacementFromNote(note);
              }
              const spaces = articulationStaffSpacesFromHint(
                artEl.getAttribute(HITL_ART_DISTANCE_ATTR),
                parseInt(artEl.getAttribute('default-y') ?? '', 10) || 0,
              );
              const dy = String(
                articulationDefaultYFromStaffSpaces(placement as 'above' | 'below', spaces),
              );
              const glyph = LIFT_ARTICULATION_GLYPH[tag] ?? '>';

              const direction = doc.createElement('direction');
              direction.setAttribute('placement', placement);
              direction.setAttribute('default-y', dy);
              direction.setAttribute(HITL_LIFTED_ART_ATTR, tag);
              if (artEl.getAttribute(HITL_ART_DISTANCE_ATTR)) {
                direction.setAttribute(
                  HITL_ART_DISTANCE_ATTR,
                  artEl.getAttribute(HITL_ART_DISTANCE_ATTR)!,
                );
              }
              const dt = doc.createElement('direction-type');
              // OSMD UnknownExpression(words) — mf/dynamics와 같이 OSMD가 그리고 VexFlow Articulation을 타지 않음.
              // 칸 수 크기는 OSMD가 거의 무시하므로 default-y는 거리 힌트 + 이후 SVG extraY에 씀.
              const words = doc.createElement('words');
              words.setAttribute('default-y', dy);
              words.setAttribute('font-size', '18');
              words.setAttribute('font-weight', 'bold');
              words.textContent = glyph;
              dt.appendChild(words);
              direction.appendChild(dt);
              const staffEl = doc.createElement('staff');
              staffEl.textContent = staffText;
              direction.appendChild(staffEl);
              if (voiceText) {
                const voiceEl = doc.createElement('voice');
                voiceEl.textContent = voiceText;
                direction.appendChild(voiceEl);
              }
              measure.insertBefore(direction, note);
              artEl.remove();
              changed = true;
            }
            if (![...arts.children].length) arts.remove();
          }
          const stillArts = [...nots.children].some((c) => xmlLocalName(c) === 'articulations');
          const other = [...nots.children].filter((c) => xmlLocalName(c) !== 'articulations');
          if (!stillArts && other.length === 0) nots.remove();
        }
      }
    }
  }
  return changed ? serializeMusicXmlDocument(doc) : xml;
}
