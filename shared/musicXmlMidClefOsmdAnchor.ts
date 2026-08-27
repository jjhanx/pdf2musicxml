/**
 * OSMD preview: trailing mid-measure `<clef>` (no following note in the same
 * layer) is treated as end-of-measure courtesy and often drawn off-canvas
 * (x≈-75). Append a tiny invisible rest after the clef so OSMD builds in-staff
 * `vfClefBefore`.
 *
 * Same-layer trailing includes: measure end with no later note, and mid clef
 * immediately before `<backup>`/`<forward>` (notes after backup are another
 * layer — e.g. piano PL voice then bass layer). Preview-only — saved MXL
 * unchanged.
 */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';
import { measureTimelineEndDivisions } from './musicXmlUnderfullMeasureForOsmd';

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

/** Last rhythmic note before `beforeEl` (same layer — ignore notes after backup). */
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

/**
 * True if a note follows in the same MusicXML layer (before next backup/forward).
 * Notes after backup belong to another voice/layer and do not “own” this clef.
 */
function hasFollowingNoteInSameLayer(measure: Element, afterEl: Element): boolean {
  const children = [...measure.children];
  const idx = children.indexOf(afterEl);
  if (idx < 0) return false;
  for (let j = idx + 1; j < children.length; j += 1) {
    const tag = xmlLocalName(children[j]!);
    if (tag === 'backup' || tag === 'forward') return false;
    if (tag === 'note') return true;
  }
  return false;
}

function isAlreadyAnchored(measure: Element, attrs: Element): boolean {
  const children = [...measure.children];
  const idx = children.indexOf(attrs);
  if (idx < 0) return false;
  const next = children[idx + 1];
  if (!next || xmlLocalName(next) !== 'note') return false;
  if (!next.querySelector(':scope > rest, :scope > *|rest')) return false;
  return (next.getAttribute('print-object') || '').toLowerCase() === 'no';
}

function clefStaffNumber(attrs: Element): string | null {
  for (const c of [...attrs.children]) {
    if (xmlLocalName(c) !== 'clef') continue;
    const n = c.getAttribute('number')?.trim();
    if (n) return n;
  }
  return null;
}

function appendInvisibleRestAfter(
  attrs: Element,
  duration: number,
  voice: string,
  staff: string | null,
): void {
  const doc = attrs.ownerDocument!;
  const measure = attrs.parentElement!;
  const note = mk(doc, measure, 'note');
  note.setAttribute('print-object', 'no');
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
  const next = attrs.nextSibling;
  if (next) measure.insertBefore(note, next);
  else measure.appendChild(note);
}

/** Mid clef with no following same-layer note → invisible rest after clef (OSMD in-staff). */
export function anchorTrailingMidClefsInMeasure(measure: Element): boolean {
  const children = [...measure.children];
  let seenNote = false;
  const trailing: Element[] = [];
  for (const el of children) {
    const tag = xmlLocalName(el);
    if (tag === 'note') {
      seenNote = true;
      continue;
    }
    if (!seenNote || tag !== 'attributes') continue;
    if (![...el.children].some((c) => xmlLocalName(c) === 'clef')) continue;
    if (!hasFollowingNoteInSameLayer(measure, el)) trailing.push(el);
  }
  if (!trailing.length) return false;

  const attrs = trailing[trailing.length - 1]!;
  if (isAlreadyAnchored(measure, attrs)) return false;

  const lastNote = lastRhythmicNoteBefore(measure, attrs);
  if (!lastNote) return false;
  const voice =
    lastNote.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || '1';
  const staffFromNote =
    lastNote.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() || null;
  const staff = staffFromNote || clefStaffNumber(attrs);
  const durEl = lastNote.querySelector(':scope > duration, :scope > *|duration');
  if (!durEl?.textContent) return false;
  let dur = parseInt(durEl.textContent.trim(), 10);
  if (!Number.isFinite(dur) || dur < 1) return false;

  const timelineEnd = measureTimelineEndDivisions(measure);
  // Prefer peeling from same-layer last note so attributes stay before measure end
  if (dur <= 1) {
    const div = readDivisions(measure);
    setDivisions(measure, div * 2);
    scaleAllDurations(measure, 2);
    dur = parseInt(durEl.textContent.trim(), 10);
  }
  if (dur > 1) {
    durEl.textContent = String(dur - 1);
    appendInvisibleRestAfter(attrs, 1, voice, staff);
    return true;
  }

  // Fallback: underfull — just append rest
  if (timelineEnd >= 0) {
    appendInvisibleRestAfter(attrs, 1, voice, staff);
    return true;
  }
  return false;
}

export function anchorTrailingMidClefsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    let changed = false;
    for (const part of findXmlParts(doc)) {
      for (const child of [...part.children]) {
        if (xmlLocalName(child) !== 'measure') continue;
        if (anchorTrailingMidClefsInMeasure(child)) changed = true;
      }
    }
    return changed ? serializeMusicXmlDocument(doc) : xml;
  } catch {
    return xml;
  }
}
