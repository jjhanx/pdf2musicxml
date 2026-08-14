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

const SHORT_REST_TYPES = new Set(['quarter', 'eighth', '16th', '32nd', '64th', '128th']);

function noteStaffN(note: Element): number {
  const el = note.querySelector(':scope > staff, :scope > *|staff');
  const n = parseInt(el?.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function noteVoice(note: Element): string {
  return note.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || '1';
}

function noteTypeName(note: Element): string {
  return note.querySelector(':scope > type, :scope > *|type')?.textContent?.trim() || '';
}

function middleLineForClef(sign: string, line: number): { step: string; octave: number } {
  const s = sign.trim().toUpperCase();
  if (s === 'F') return { step: 'D', octave: 3 };
  if (s === 'C' && line === 4) return { step: 'A', octave: 3 };
  if (s === 'C') return { step: 'C', octave: 4 };
  return { step: 'B', octave: 4 };
}

function setRestDisplay(restEl: Element, step: string, octave: number): void {
  const doc = restEl.ownerDocument;
  if (!doc) return;
  const ns = restEl.namespaceURI;
  let stepEl = restEl.querySelector(':scope > display-step, :scope > *|display-step');
  let octEl = restEl.querySelector(':scope > display-octave, :scope > *|display-octave');
  if (!stepEl) {
    stepEl = ns ? doc.createElementNS(ns, 'display-step') : doc.createElement('display-step');
    restEl.appendChild(stepEl);
  }
  if (!octEl) {
    octEl = ns ? doc.createElementNS(ns, 'display-octave') : doc.createElement('display-octave');
    restEl.appendChild(octEl);
  }
  stepEl.textContent = step;
  octEl.textContent = String(octave);
}

function pinPolyphonicShortRestsInMeasure(measure: Element, clefByStaff: Map<number, { sign: string; line: number }>): void {
  const voicesByStaff = new Map<number, Set<string>>();
  for (const note of [...measure.children]) {
    if (xmlLocalName(note) !== 'note') continue;
    if (note.querySelector(':scope > grace, :scope > *|grace')) continue;
    const staff = noteStaffN(note);
    const set = voicesByStaff.get(staff) ?? new Set<string>();
    set.add(noteVoice(note));
    voicesByStaff.set(staff, set);
  }
  for (const note of [...measure.children]) {
    if (xmlLocalName(note) !== 'note') continue;
    const restEl = note.querySelector(':scope > rest, :scope > *|rest');
    if (!restEl) continue;
    const staff = noteStaffN(note);
    if ((voicesByStaff.get(staff)?.size ?? 0) < 2) continue;
    if (!SHORT_REST_TYPES.has(noteTypeName(note))) continue;
    const clef = clefByStaff.get(staff) ?? { sign: staff >= 2 ? 'F' : 'G', line: staff >= 2 ? 4 : 2 };
    const mid = middleLineForClef(clef.sign, clef.line);
    setRestDisplay(restEl, mid.step, mid.octave);
  }
}

function repairRestDisplayInPart(part: Element): void {
  const clefByStaff = new Map<number, { sign: string; line: number }>();
  for (const measure of [...part.children]) {
    if (xmlLocalName(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (xmlLocalName(child) !== 'attributes') continue;
      for (const clef of [...child.children]) {
        if (xmlLocalName(clef) !== 'clef') continue;
        const numRaw = clef.getAttribute('number');
        const staffN = numRaw && /^\d+$/.test(numRaw) ? parseInt(numRaw, 10) : 1;
        const sign = clef.querySelector('sign, *|sign')?.textContent?.trim() || 'G';
        const lineRaw = clef.querySelector('line, *|line')?.textContent?.trim() || '';
        const line = parseInt(lineRaw, 10);
        clefByStaff.set(staffN, { sign, line: Number.isFinite(line) ? line : 2 });
      }
    }
    for (const note of [...measure.children]) {
      if (xmlLocalName(note) !== 'note') continue;
      const restEl = note.querySelector(':scope > rest, :scope > *|rest');
      if (restEl) clearRestDisplayHints(restEl);
    }
    pinPolyphonicShortRestsInMeasure(measure, clefByStaff);
  }
}

/**
 * OSMD/HITL 미리보기 — 잘못된 Audiveris rest 힌트는 지우고,
 * 같은 오선 다성부 짧은 쉼표는 오선 중선(F clef=D3, G=B4)에 고정한다.
 * OSMD 기본 배치는 윗 voice 쉼표를 오선 밖으로 올려 8분쉼표가 잘못 읽히기 쉽다.
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
