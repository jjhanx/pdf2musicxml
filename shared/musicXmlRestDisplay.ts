import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';

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

function clearRestDisplayHints(restEl: Element): void {
  restEl
    .querySelectorAll(
      ':scope > display-step, :scope > *|display-step, :scope > display-octave, :scope > *|display-octave',
    )
    .forEach((el) => el.remove());
}

const NOTE_TYPE_MULTIPLIERS: Array<{ name: string; mult: number }> = [
  { name: 'whole', mult: 4 },
  { name: 'half', mult: 2 },
  { name: 'quarter', mult: 1 },
  { name: 'eighth', mult: 0.5 },
  { name: '16th', mult: 0.25 },
  { name: '32nd', mult: 0.125 },
  { name: '64th', mult: 0.0625 },
];

function inferNoteTypeFromDuration(duration: number, divisions: number, dotCount: number): string | null {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(divisions) || divisions <= 0) return null;
  let beats = duration / divisions;
  if (dotCount === 1) beats /= 1.5;
  else if (dotCount === 2) beats /= 1.75;
  else if (dotCount > 2) beats /= 1.875;
  for (const { name, mult } of NOTE_TYPE_MULTIPLIERS) {
    if (Math.abs(beats - mult) < 0.02) return name;
  }
  return null;
}

function insertTypeAfterDuration(note: Element, typeName: string): void {
  if (note.querySelector(':scope > type, :scope > *|type')) return;
  const doc = note.ownerDocument;
  if (!doc) return;
  const typeEl = doc.createElementNS(note.namespaceURI, 'type');
  typeEl.textContent = typeName;
  const dur = [...note.children].find((c) => xmlLocalName(c) === 'duration');
  if (dur?.nextSibling) note.insertBefore(typeEl, dur.nextSibling);
  else note.appendChild(typeEl);
}

function repairMissingNoteTypesInPart(part: Element): void {
  let divisions = 1;
  for (const measure of [...part.children]) {
    if (xmlLocalName(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (xmlLocalName(child) !== 'attributes') continue;
      const divEl = child.querySelector('divisions, *|divisions');
      const parsed = parseInt(divEl?.textContent?.trim() ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) divisions = parsed;
    }
    for (const note of [...measure.children]) {
      if (xmlLocalName(note) !== 'note') continue;
      if (note.querySelector(':scope > type, :scope > *|type')) continue;
      const durEl = note.querySelector(':scope > duration, :scope > *|duration');
      const duration = parseInt(durEl?.textContent?.trim() ?? '', 10);
      if (!Number.isFinite(duration) || duration <= 0) continue;
      const dots = note.querySelectorAll(':scope > dot, :scope > *|dot').length;
      const inferred = inferNoteTypeFromDuration(duration, divisions, dots);
      if (inferred) insertTypeAfterDuration(note, inferred);
    }
  }
}

function repairRestDisplayInPart(part: Element): void {
  for (const measure of [...part.children]) {
    if (xmlLocalName(measure) !== 'measure') continue;
    for (const note of [...measure.children]) {
      if (xmlLocalName(note) !== 'note') continue;
      const restEl = note.querySelector(':scope > rest, :scope > *|rest');
      if (restEl) clearRestDisplayHints(restEl);
    }
  }
}

/**
 * OSMD/HITL 미리보기 전용 — Audiveris rest `display-step`/`display-octave` 힌트 제거.
 * 온·2분·마디전체(D/C/E)뿐 아니라 4·8·16분 등 짧은 쉼(B4 등)도 OSMD 기본 위치로 그리게 한다.
 */
export function repairRestDisplayForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      repairRestDisplayInPart(part);
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/**
 * OSMD/HITL 미리보기 전용 — `<type>` 없는 note/rest에 duration·divisions로 길이 종류 추론.
 * Audiveris Voice(P4) 등 초반 마디 전체 쉼에 type이 빠지면 OSMD 전 악보 load가 `duration is not valid: u` 로 실패.
 */
export function repairMissingNoteTypesForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      repairMissingNoteTypesInPart(part);
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

/** rest display + missing `<type>` — OSMD load 직전 한 번에 적용 */
export function repairNotesForOsmdPreview(xml: string): string {
  return repairMissingNoteTypesForOsmdPreview(repairRestDisplayForOsmdPreview(xml));
}
