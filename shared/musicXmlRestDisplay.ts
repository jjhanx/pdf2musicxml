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

function childByLocal(parent: Element, name: string): Element | undefined {
  return [...parent.children].find((c) => xmlLocalName(c) === name);
}

function clearRestDisplayHints(restEl: Element): void {
  restEl
    .querySelectorAll(
      ':scope > display-step, :scope > *|display-step, :scope > display-octave, :scope > *|display-octave',
    )
    .forEach((el) => el.remove());
}

function setRestDisplay(restEl: Element, step: string, octave: number): void {
  const doc = restEl.ownerDocument;
  if (!doc) return;
  let stepEl = childByLocal(restEl, 'display-step');
  if (!stepEl) {
    stepEl = doc.createElementNS(restEl.namespaceURI, 'display-step');
    restEl.appendChild(stepEl);
  }
  stepEl.textContent = step;
  let octEl = childByLocal(restEl, 'display-octave');
  if (!octEl) {
    octEl = doc.createElementNS(restEl.namespaceURI, 'display-octave');
    restEl.appendChild(octEl);
  }
  octEl.textContent = String(octave);
}

const SHORT_REST_TYPES = new Set(['quarter', 'eighth', '16th', '32nd', '64th', '128th']);

/** 음자리표 중선 — G/2=B4, F/4=D3, C/3=C4, C/4=A3. */
function staffMiddleDisplay(sign: string, line: number): { step: string; octave: number } {
  const s = sign.trim().toUpperCase();
  if (s === 'F') return { step: 'D', octave: 3 };
  if (s === 'C') return line === 4 ? { step: 'A', octave: 3 } : { step: 'C', octave: 4 };
  return { step: 'B', octave: 4 };
}

function noteStaffN(note: Element): number {
  const el = childByLocal(note, 'staff');
  const n = parseInt(el?.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function noteVoiceN(note: Element): string {
  const el = childByLocal(note, 'voice');
  return el?.textContent?.trim() || '1';
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
  const clefByStaff = new Map<number, { sign: string; line: number }>();
  for (const measure of [...part.children]) {
    if (xmlLocalName(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (xmlLocalName(child) !== 'attributes') continue;
      for (const clef of [...child.children]) {
        if (xmlLocalName(clef) !== 'clef') continue;
        const numRaw = clef.getAttribute('number');
        const staffN = numRaw && /^\d+$/.test(numRaw) ? parseInt(numRaw, 10) : 1;
        const sign = childByLocal(clef, 'sign')?.textContent?.trim() || 'G';
        const lineRaw = childByLocal(clef, 'line')?.textContent?.trim() || '';
        const line = /^\d+$/.test(lineRaw) ? parseInt(lineRaw, 10) : sign.toUpperCase() === 'F' ? 4 : 2;
        clefByStaff.set(staffN, { sign, line });
      }
    }

    const voicesByStaff = new Map<number, Set<string>>();
    for (const note of [...measure.children]) {
      if (xmlLocalName(note) !== 'note') continue;
      if (childByLocal(note, 'grace') || childByLocal(note, 'chord')) continue;
      const staffN = noteStaffN(note);
      const set = voicesByStaff.get(staffN) ?? new Set<string>();
      set.add(noteVoiceN(note));
      voicesByStaff.set(staffN, set);
    }

    for (const note of [...measure.children]) {
      if (xmlLocalName(note) !== 'note') continue;
      const restEl = childByLocal(note, 'rest');
      if (!restEl) continue;
      const typeName = childByLocal(note, 'type')?.textContent?.trim() || '';
      const measureRest = restEl.getAttribute('measure') === 'yes';
      const staffN = noteStaffN(note);
      const polyphonic = (voicesByStaff.get(staffN)?.size ?? 0) >= 2;
      if (SHORT_REST_TYPES.has(typeName) && polyphonic) {
        const clef = clefByStaff.get(staffN) ?? { sign: 'G', line: 2 };
        const mid = staffMiddleDisplay(clef.sign, clef.line);
        setRestDisplay(restEl, mid.step, mid.octave);
        continue;
      }
      if (measureRest || typeName === 'whole' || typeName === 'half' || SHORT_REST_TYPES.has(typeName)) {
        clearRestDisplayHints(restEl);
      }
    }
  }
}

/**
 * OSMD/HITL 미리보기 전용.
 * 온·2분·마디전체 쉼의 과대 display-step은 지운다.
 * 같은 오선에 voice가 둘 이상인 짧은 쉼은 중선(G=B4, F=D3)에 고정한다.
 * (힌트를 지우면 OSMD가 윗성부 쉼표를 오선 밖으로 밀어 올린다.)
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
