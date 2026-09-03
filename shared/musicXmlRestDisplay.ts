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

const SHORT_REST_TYPES = new Set(['half', 'quarter', 'eighth', '16th', '32nd', '64th', '128th']);
const STEP_DIATONIC: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** 음자리표 중선 — G/2=B4, F/4=D3, C/3=C4, C/4=A3. */
function staffMiddleDisplay(sign: string, line: number): { step: string; octave: number } {
  const s = sign.trim().toUpperCase();
  if (s === 'F') return { step: 'D', octave: 3 };
  if (s === 'C') return line === 4 ? { step: 'A', octave: 3 } : { step: 'C', octave: 4 };
  return { step: 'B', octave: 4 };
}

function middleLineDiatonic(sign: string, line: number): number {
  const mid = staffMiddleDisplay(sign, line);
  return mid.octave * 7 + (STEP_DIATONIC[mid.step] ?? 0);
}

function fromDiatonicIndex(idx: number): { step: string; octave: number } {
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const octave = Math.floor(idx / 7);
  const step = steps[((idx % 7) + 7) % 7]!;
  return { step, octave };
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

function noteDuration(note: Element): number {
  const el = childByLocal(note, 'duration');
  const n = parseInt(el?.textContent?.trim() ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function pitchDiatonic(note: Element): number | null {
  const pitch = childByLocal(note, 'pitch');
  if (!pitch) return null;
  const step = childByLocal(pitch, 'step')?.textContent?.trim().toUpperCase() ?? '';
  const octRaw = childByLocal(pitch, 'octave')?.textContent?.trim() ?? '';
  const oct = parseInt(octRaw, 10);
  if (!(step in STEP_DIATONIC) || !Number.isFinite(oct)) return null;
  return oct * 7 + STEP_DIATONIC[step]!;
}

function chooseRestDisplayDiatonic(mid: number, otherPitches: number[], blocked: Set<number>): number {
  const lo = mid - 4;
  const hi = mid + 4;
  if (otherPitches.length === 0) {
    if (!blocked.has(mid) && mid >= lo && mid <= hi) return mid;
    for (const cand of [mid + 1, mid - 1, mid + 2, mid - 2]) {
      if (cand >= lo && cand <= hi && !blocked.has(cand)) return cand;
    }
    return mid;
  }
  const sorted = [...otherPitches].sort((a, b) => a - b);
  // 화음 2음 median(floor(n/2))은 높은 음만 골라 중선 걸친 화음에서 방향을 뒤집는다.
  let wantAbove: boolean;
  if (sorted.every((p) => p <= mid)) wantAbove = true;
  else if (sorted.every((p) => p >= mid)) wantAbove = false;
  else wantAbove = sorted.reduce((a, b) => a + b, 0) / sorted.length < mid;
  const preferred: number[] = [];
  for (const off of [2, 3, 1, 4]) {
    const cand = wantAbove ? mid + off : mid - off;
    if (cand >= lo && cand <= hi) preferred.push(cand);
  }
  preferred.push(mid);
  for (let d = lo; d <= hi; d += 1) {
    if (!preferred.includes(d)) preferred.push(d);
  }
  for (const cand of preferred) {
    if (!blocked.has(cand)) return cand;
  }
  const target = wantAbove ? mid + 2 : mid - 2;
  return Math.max(lo, Math.min(hi, target));
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

function applyClefFromAttributes(
  attrs: Element,
  clefByStaff: Map<number, { sign: string; line: number }>,
): void {
  for (const clef of [...attrs.children]) {
    if (xmlLocalName(clef) !== 'clef') continue;
    const numRaw = clef.getAttribute('number');
    const staffN = numRaw && /^\d+$/.test(numRaw) ? parseInt(numRaw, 10) : 1;
    const sign = childByLocal(clef, 'sign')?.textContent?.trim() || 'G';
    const lineRaw = childByLocal(clef, 'line')?.textContent?.trim() || '';
    const line = /^\d+$/.test(lineRaw) ? parseInt(lineRaw, 10) : sign.toUpperCase() === 'F' ? 4 : 2;
    clefByStaff.set(staffN, { sign, line });
  }
}

type NoteEvent = {
  note: Element;
  staff: number;
  voice: string;
  start: number;
  dur: number;
  isRest: boolean;
  isChord: boolean;
  dia: number | null;
};

function collectStaffNoteEvents(measure: Element): NoteEvent[] {
  const voiceCursor = new Map<string, number>();
  let lastVoice = '1';
  const out: NoteEvent[] = [];
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'backup') {
      const dur = noteDuration(child);
      const v =
        childByLocal(child, 'voice')?.textContent?.trim() || lastVoice;
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - dur));
      continue;
    }
    if (tag === 'forward') {
      const dur = noteDuration(child);
      const v =
        childByLocal(child, 'voice')?.textContent?.trim() || lastVoice;
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + dur);
      continue;
    }
    if (tag !== 'note') continue;
    if (childByLocal(child, 'grace')) continue;
    const isChord = !!childByLocal(child, 'chord');
    const staff = noteStaffN(child);
    const voice = noteVoiceN(child);
    const isRest = !!childByLocal(child, 'rest');
    const dia = isRest ? null : pitchDiatonic(child);
    if (isChord) {
      const leader = [...out].reverse().find((e) => !e.isChord && e.staff === staff && e.voice === voice);
      out.push({
        note: child,
        staff,
        voice,
        start: leader?.start ?? voiceCursor.get(voice) ?? 0,
        dur: leader?.dur ?? Math.max(1, noteDuration(child)),
        isRest,
        isChord: true,
        dia,
      });
      continue;
    }
    lastVoice = voice;
    const start = voiceCursor.get(voice) ?? 0;
    const dur = Math.max(1, noteDuration(child));
    out.push({ note: child, staff, voice, start, dur, isRest, isChord: false, dia });
    voiceCursor.set(voice, start + dur);
  }
  return out;
}

function polyphonicShortRestDisplay(
  restEvent: NoteEvent,
  events: NoteEvent[],
  clef: { sign: string; line: number },
): { step: string; octave: number } {
  const mid = middleLineDiatonic(clef.sign, clef.line);
  const restStart = restEvent.start;
  const restEnd = restStart + restEvent.dur;
  const otherPitches: number[] = [];
  const blocked = new Set<number>();

  for (const ev of events) {
    if (ev.isRest || ev.dia == null) continue;
    if (ev.staff !== restEvent.staff || ev.voice === restEvent.voice) continue;
    if (ev.start >= restEnd || ev.start + ev.dur <= restStart) continue;
    otherPitches.push(ev.dia);
    blocked.add(ev.dia);
  }
  if (otherPitches.length === 0) {
    for (const ev of events) {
      if (ev.isRest || ev.dia == null) continue;
      if (ev.staff !== restEvent.staff || ev.voice === restEvent.voice) continue;
      otherPitches.push(ev.dia);
    }
  }
  const chosen = chooseRestDisplayDiatonic(mid, otherPitches, blocked);
  return fromDiatonicIndex(chosen);
}

function repairRestDisplayInPart(part: Element): void {
  // Persist across measures so mid-measure clefs do not leak backward onto earlier rests.
  const clefByStaff = new Map<number, { sign: string; line: number }>();
  for (const measure of [...part.children]) {
    if (xmlLocalName(measure) !== 'measure') continue;

    const voicesByStaff = new Map<number, Set<string>>();
    for (const note of [...measure.children]) {
      if (xmlLocalName(note) !== 'note') continue;
      if (childByLocal(note, 'grace') || childByLocal(note, 'chord')) continue;
      const staffN = noteStaffN(note);
      const set = voicesByStaff.get(staffN) ?? new Set<string>();
      set.add(noteVoiceN(note));
      voicesByStaff.set(staffN, set);
    }

    const events = collectStaffNoteEvents(measure);
    const eventByNote = new Map<Element, NoteEvent>();
    for (const ev of events) eventByNote.set(ev.note, ev);

    // Document order: apply clef only when reached, so a later mid clef (e.g. F→G)
    // does not pin an opening short rest to the wrong staff middle (B4 on bass).
    for (const child of [...measure.children]) {
      const tag = xmlLocalName(child);
      if (tag === 'attributes') {
        applyClefFromAttributes(child, clefByStaff);
        continue;
      }
      if (tag !== 'note') continue;
      const restEl = childByLocal(child, 'rest');
      if (!restEl) continue;
      const typeName = childByLocal(child, 'type')?.textContent?.trim() || '';
      const measureRest = restEl.getAttribute('measure') === 'yes';
      const staffN = noteStaffN(child);
      const polyphonic = (voicesByStaff.get(staffN)?.size ?? 0) >= 2;
      if (SHORT_REST_TYPES.has(typeName) && polyphonic) {
        const clef = clefByStaff.get(staffN) ?? { sign: 'G', line: 2 };
        const restEvent = eventByNote.get(child);
        const place = restEvent
          ? polyphonicShortRestDisplay(restEvent, events, clef)
          : staffMiddleDisplay(clef.sign, clef.line);
        setRestDisplay(restEl, place.step, place.octave);
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
 * 같은 오선에 voice가 둘 이상인 짧은 쉼은 **동시 다른 voice 음의 반대편**(오선 안)에 둔다.
 * (힌트를 지우면 OSMD가 윗성부 쉼표를 오선 밖으로 밀어 올린다.
 *  마디 뒤 mid clef를 쓰면 앞쪽 쉼표가 잘못된 중선으로 고정되므로 document order로 clef 적용.)
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
