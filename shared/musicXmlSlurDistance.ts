import {
  articulationDefaultYFromStaffSpaces,
  articulationStaffSpacesFromHint,
  HITL_DIR_DISTANCE_ATTR,
} from './musicXmlArticulationDistance';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';

export const HITL_SLUR_DISTANCE_ATTR = 'data-hitl-slur-distance';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function findXmlParts(doc: Document): Element[] {
  const out: Element[] = [];
  const root = doc.documentElement;
  if (!root) return out;
  const walk = (el: Element) => {
    if (xmlLocalName(el) === 'part') out.push(el);
    for (const c of [...el.children]) walk(c);
  };
  walk(root);
  return out;
}

export type SlurDistanceFix = {
  kind: string;
  partId: string;
  measureMxl: string | number;
  noteIndex?: number;
  fromNoteIndex?: number;
  toNoteIndex?: number;
  slurEnd?: 'start' | 'stop' | 'both' | string;
  placement?: 'above' | 'below' | null;
  distance?: string | null;
};

export function normalizedSlurDistance(raw: string | null | undefined): string | null {
  const d = (raw || '').trim().toLowerCase();
  if (!d || d === 'auto') return null;
  return articulationStaffSpacesFromHint(d, null) > 0 ? d : null;
}

export function slurDefaultY(
  placement: 'above' | 'below',
  distance: string | null | undefined,
  fallbackDefaultY?: number | null,
): number {
  const spaces = articulationStaffSpacesFromHint(distance, fallbackDefaultY ?? null);
  return articulationDefaultYFromStaffSpaces(placement, spaces);
}

function previewPartIdsMatch(xmlPartId: string, fixPartId: string): boolean {
  if (!xmlPartId || !fixPartId) return false;
  const xBase = xmlPartId.replace(/__PR$|__PL$/, '');
  const fBase = fixPartId.replace(/__PR$|__PL$/, '');
  return xmlPartId === fixPartId || xBase === fBase || fixPartId === `${xBase}__PR` || fixPartId === `${xBase}__PL`;
}

function noteSlurElements(note: Element): Element[] {
  const out: Element[] = [];
  for (const notations of [...note.children].filter((c) => xmlLocalName(c) === 'notations')) {
    out.push(...[...notations.children].filter((c) => xmlLocalName(c) === 'slur'));
  }
  return out;
}

function applySlurDistanceAttrs(
  slur: Element,
  placement: 'above' | 'below',
  distance: string | null,
): boolean {
  let changed = false;
  if (slur.getAttribute('placement') !== placement) {
    slur.setAttribute('placement', placement);
    changed = true;
  }
  const fallbackY = distance ? parseInt(slur.getAttribute('default-y') || '', 10) || null : null;
  const dy = String(slurDefaultY(placement, distance, fallbackY));
  if (slur.getAttribute('default-y') !== dy) {
    slur.setAttribute('default-y', dy);
    changed = true;
  }
  if (distance) {
    if (slur.getAttribute(HITL_SLUR_DISTANCE_ATTR) !== distance) {
      slur.setAttribute(HITL_SLUR_DISTANCE_ATTR, distance);
      changed = true;
    }
    if (slur.getAttribute(HITL_DIR_DISTANCE_ATTR) !== distance) {
      slur.setAttribute(HITL_DIR_DISTANCE_ATTR, distance);
      changed = true;
    }
  } else {
    if (slur.hasAttribute(HITL_SLUR_DISTANCE_ATTR)) {
      slur.removeAttribute(HITL_SLUR_DISTANCE_ATTR);
      changed = true;
    }
    if (slur.hasAttribute(HITL_DIR_DISTANCE_ATTR)) {
      slur.removeAttribute(HITL_DIR_DISTANCE_ATTR);
      changed = true;
    }
  }
  return changed;
}

export function applySlurDistanceFixesToPreviewXml(
  xml: string,
  fixes: ReadonlyArray<SlurDistanceFix>,
): string {
  const slurFixes = fixes.filter(
    (f) =>
      (f.kind === 'setSlurPlacement' || f.kind === 'addSlur') &&
      (f.distance !== undefined || f.placement === 'above' || f.placement === 'below'),
  );
  if (!slurFixes.length) return xml;

  const doc = parseMusicXmlDocument(xml);
  if (!doc) return xml;
  let changed = false;

  for (const fix of slurFixes) {
    const targetMxl = String(fix.measureMxl ?? '').trim();
    const idx = fix.kind === 'addSlur' ? fix.fromNoteIndex : fix.noteIndex;
    if (idx == null) continue;
    for (const part of findXmlParts(doc).filter((p) =>
      previewPartIdsMatch(p.getAttribute('id')?.trim() || '', fix.partId),
    )) {
      const measure = [...part.children].find(
        (c) => xmlLocalName(c) === 'measure' && (!targetMxl || c.getAttribute('number')?.trim() === targetMxl),
      );
      if (!measure) continue;
      const notes = [...measure.children].filter((c) => xmlLocalName(c) === 'note');
      const note = notes[idx];
      if (!note) continue;
      const which = fix.kind === 'addSlur' ? 'start' : (fix.slurEnd || 'both');
      const slurs = noteSlurElements(note).filter((s) => {
        const type = (s.getAttribute('type') || '').trim();
        return which === 'both' || type === which;
      });
      for (const slur of slurs) {
        const placement =
          fix.placement === 'above' || fix.placement === 'below'
            ? fix.placement
            : (slur.getAttribute('placement') || 'below') === 'above'
              ? 'above'
              : 'below';
        const dist = normalizedSlurDistance(fix.distance);
        if (applySlurDistanceAttrs(slur, placement, dist)) changed = true;
      }
    }
  }

  return changed ? serializeMusicXmlDocument(doc) : xml;
}
