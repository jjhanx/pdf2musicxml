/**
 * OSMD preview: measure-end `<direction>` (HITL `data-hitl-measure-anchor="end"`
 * or last child before barline) is timed at the **previous note onset**, so mf/rit.
 * sit on the last note instead of empty space near the barline.
 *
 * Append a tiny `print-object=no` rest after the direction (peel 1 from the prior
 * rhythmic note, refining divisions when a whole fills the bar) so OSMD anchors
 * the expression to a late onset. Preview-only — saved MXL unchanged.
 */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
import { measureTimelineEndDivisions } from './musicXmlUnderfullMeasureForOsmd';

export const HITL_MEASURE_ANCHOR_ATTR = 'data-hitl-measure-anchor';
export const HITL_MEASURE_END_ANCHOR_REST_ATTR = 'data-hitl-measure-end-anchor-rest';

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

function mk(doc: Document, parent: Element, local: string): Element {
  const ns = parent.namespaceURI;
  return ns ? doc.createElementNS(ns, local) : doc.createElement(local);
}

function readDivisions(measure: Element): number {
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'attributes') continue;
    const d = child.querySelector('divisions, *|divisions')?.textContent?.trim();
    const n = parseInt(d ?? '', 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}

function setDivisions(measure: Element, divisions: number): void {
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'attributes') continue;
    let d = child.querySelector('divisions, *|divisions');
    if (!d) {
      d = mk(measure.ownerDocument!, child, 'divisions');
      child.insertBefore(d, child.firstChild);
    }
    d.textContent = String(divisions);
    return;
  }
}

function scaleAllDurations(measure: Element, factor: number): void {
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag !== 'note' && tag !== 'backup' && tag !== 'forward') continue;
    const dur = child.querySelector(':scope > duration, :scope > *|duration');
    if (!dur?.textContent) continue;
    const n = parseInt(dur.textContent.trim(), 10);
    if (Number.isFinite(n) && n > 0) dur.textContent = String(n * factor);
  }
}

/** True if nothing after is note/backup/forward (barline / direction / print OK). */
export function directionIsAtMeasureEnd(measure: Element, direction: Element): boolean {
  if ((direction.getAttribute(HITL_MEASURE_ANCHOR_ATTR) || '').trim().toLowerCase() === 'end') {
    return true;
  }
  const children = [...measure.children];
  const idx = children.indexOf(direction);
  if (idx < 0) return false;
  for (let i = idx + 1; i < children.length; i += 1) {
    const tag = xmlLocalName(children[i]!);
    if (tag === 'note' || tag === 'backup' || tag === 'forward') return false;
  }
  return true;
}

function lastRhythmicNoteBefore(measure: Element, beforeEl: Element): Element | null {
  const children = [...measure.children];
  const end = children.indexOf(beforeEl);
  if (end < 0) return null;
  let last: Element | null = null;
  for (let i = 0; i < end; i += 1) {
    const child = children[i]!;
    const tag = xmlLocalName(child);
    if (tag === 'backup' || tag === 'forward') {
      last = null;
      continue;
    }
    if (tag !== 'note') continue;
    if (child.querySelector(':scope > chord, :scope > *|chord')) continue;
    if (child.querySelector(':scope > grace, :scope > *|grace')) continue;
    last = child;
  }
  return last;
}

function noteTypeName(note: Element): string {
  return (
    note.querySelector(':scope > type, :scope > *|type')?.textContent?.trim().toLowerCase() || ''
  );
}

function typeForDurationUnits(duration: number, divisions: number): string {
  const q = duration / Math.max(1, divisions);
  if (q >= 3.5) return 'whole';
  if (q >= 1.5) return 'half';
  if (q >= 0.75) return 'quarter';
  if (q >= 0.4) return 'eighth';
  if (q >= 0.2) return '16th';
  return '32nd';
}

function setNoteType(note: Element, typeName: string): void {
  let typeEl = note.querySelector(':scope > type, :scope > *|type');
  if (!typeEl) {
    const doc = note.ownerDocument!;
    typeEl = mk(doc, note, 'type');
    const voice = note.querySelector(':scope > voice, :scope > *|voice');
    if (voice?.nextSibling) note.insertBefore(typeEl, voice.nextSibling);
    else note.appendChild(typeEl);
  }
  typeEl.textContent = typeName;
  for (const d of [...note.children].filter((c) => xmlLocalName(c) === 'dot')) d.remove();
}

function isAlreadyAnchoredAfter(direction: Element): boolean {
  const next = direction.nextElementSibling;
  if (!next || xmlLocalName(next) !== 'note') return false;
  if (!next.querySelector(':scope > rest, :scope > *|rest')) return false;
  if ((next.getAttribute('print-object') || '').toLowerCase() !== 'no') return false;
  return next.getAttribute(HITL_MEASURE_END_ANCHOR_REST_ATTR) === '1';
}

function directionHasWedge(dir: Element): boolean {
  return dir.querySelector('wedge, *|wedge') != null;
}

function appendInvisibleRestAfter(
  afterEl: Element,
  duration: number,
  voice: string,
  staff: string | null,
): void {
  const doc = afterEl.ownerDocument!;
  const measure = afterEl.parentElement!;
  const note = mk(doc, measure, 'note');
  note.setAttribute('print-object', 'no');
  note.setAttribute(HITL_MEASURE_END_ANCHOR_REST_ATTR, '1');
  note.appendChild(mk(doc, note, 'rest'));
  const dur = mk(doc, note, 'duration');
  dur.textContent = String(Math.max(1, duration));
  note.appendChild(dur);
  const v = mk(doc, note, 'voice');
  v.textContent = voice || '1';
  note.appendChild(v);
  const type = mk(doc, note, 'type');
  type.textContent = '16th';
  note.appendChild(type);
  if (staff) {
    const st = mk(doc, note, 'staff');
    st.textContent = staff;
    note.appendChild(st);
  }
  const next = afterEl.nextSibling;
  if (next) measure.insertBefore(note, next);
  else measure.appendChild(note);
}

/**
 * HITL-marked measure-end directions only (`data-hitl-measure-anchor="end"`).
 * Skip wedges (stop length is intentional). Consecutive marked dirs share one rest.
 */
function collectMeasureEndDirectionGroups(measure: Element): Element[][] {
  const children = [...measure.children];
  const marked: Element[] = [];
  for (const el of children) {
    if (xmlLocalName(el) !== 'direction') continue;
    if (directionHasWedge(el)) continue;
    if ((el.getAttribute(HITL_MEASURE_ANCHOR_ATTR) || '').trim().toLowerCase() !== 'end') continue;
    marked.push(el);
  }
  if (!marked.length) return [];
  const last = marked[marked.length - 1]!;
  const group: Element[] = [];
  const idx = children.indexOf(last);
  for (let i = idx; i >= 0; i -= 1) {
    const el = children[i]!;
    if (xmlLocalName(el) !== 'direction') break;
    if (directionHasWedge(el)) break;
    if ((el.getAttribute(HITL_MEASURE_ANCHOR_ATTR) || '').trim().toLowerCase() !== 'end') break;
    group.unshift(el);
  }
  return group.length ? [group] : [];
}

export function anchorMeasureEndDirectionsInMeasure(measure: Element): boolean {
  const groups = collectMeasureEndDirectionGroups(measure);
  if (!groups.length) return false;
  let changed = false;
  for (const group of groups) {
    const lastDir = group[group.length - 1]!;
    if (isAlreadyAnchoredAfter(lastDir)) continue;

    const lastNote = lastRhythmicNoteBefore(measure, group[0]!);
    const voice =
      lastNote?.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() ||
      lastDir.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() ||
      '1';
    const staff =
      lastDir.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() ||
      lastNote?.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() ||
      null;

    if (!lastNote) {
      appendInvisibleRestAfter(lastDir, 1, voice, staff);
      changed = true;
      continue;
    }

    const durEl = lastNote.querySelector(':scope > duration, :scope > *|duration');
    if (!durEl?.textContent) {
      appendInvisibleRestAfter(lastDir, 1, voice, staff);
      changed = true;
      continue;
    }
    let dur = parseInt(durEl.textContent.trim(), 10);
    if (!Number.isFinite(dur) || dur < 1) {
      appendInvisibleRestAfter(lastDir, 1, voice, staff);
      changed = true;
      continue;
    }

    const timelineEnd = measureTimelineEndDivisions(measure);
    const typ = noteTypeName(lastNote);
    const fillsBar =
      typ === 'whole' ||
      typ === 'breve' ||
      (timelineEnd > 0 && dur >= Math.max(1, Math.floor(timelineEnd * 0.75)));
    if (dur <= 1 || fillsBar) {
      const factor = fillsBar ? 8 : 2;
      const div = readDivisions(measure);
      setDivisions(measure, div * factor);
      scaleAllDurations(measure, factor);
      dur = parseInt(durEl.textContent.trim(), 10);
    }
    if (dur > 1) {
      const nextDur = dur - 1;
      durEl.textContent = String(nextDur);
      setNoteType(lastNote, typeForDurationUnits(nextDur, readDivisions(measure)));
      appendInvisibleRestAfter(lastDir, 1, voice, staff);
      changed = true;
      continue;
    }
    appendInvisibleRestAfter(lastDir, 1, voice, staff);
    changed = true;
  }
  return changed;
}

export function anchorMeasureEndDirectionsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    let changed = false;
    for (const part of findXmlParts(doc)) {
      for (const child of [...part.children]) {
        if (xmlLocalName(child) !== 'measure') continue;
        if (anchorMeasureEndDirectionsInMeasure(child)) changed = true;
      }
    }
    return changed ? serializeMusicXmlDocument(doc) : xml;
  } catch {
    return xml;
  }
}
