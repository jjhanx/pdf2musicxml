import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';

const HIGH_REST_DISPLAY_STEPS = new Set(['C', 'D', 'E']);

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

function clefSign(clef: Element): string {
  return clef.querySelector('sign, *|sign')?.textContent?.trim() ?? '';
}

function noteStaffN(noteEl: Element): number {
  const staffEl = noteEl.querySelector(':scope > staff, :scope > *|staff');
  if (!staffEl) return 1;
  const n = parseInt(staffEl.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
}

function restDisplayStepOctave(restEl: Element): { step: string; octave: number | null } {
  const stepEl = restEl.querySelector(':scope > display-step, :scope > *|display-step');
  const octEl = restEl.querySelector(':scope > display-octave, :scope > *|display-octave');
  const step = stepEl?.textContent?.trim().toUpperCase() ?? '';
  const octText = octEl?.textContent?.trim();
  const octave = octText && /^-?\d+$/.test(octText) ? parseInt(octText, 10) : null;
  return { step, octave };
}

function clearRestDisplayHints(restEl: Element): void {
  restEl
    .querySelectorAll(
      ':scope > display-step, :scope > *|display-step, :scope > display-octave, :scope > *|display-octave',
    )
    .forEach((el) => el.remove());
}

function noteTypeText(note: Element): string {
  return note.querySelector(':scope > type, :scope > *|type')?.textContent?.trim() ?? '';
}

function noteVoiceText(note: Element): string {
  return note.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() ?? '1';
}

function listMeasureNotes(measure: Element): Element[] {
  return [...measure.children].filter((c) => xmlLocalName(c) === 'note');
}

function repairRestDisplayInPart(part: Element): void {
  const clefByStaff = new Map<number, string>();
  clefByStaff.set(1, 'G');

  for (const measure of [...part.children]) {
    if (xmlLocalName(measure) !== 'measure') continue;

    for (const attr of [...measure.children]) {
      if (xmlLocalName(attr) !== 'attributes') continue;
      for (const clef of [...attr.children].filter((c) => xmlLocalName(c) === 'clef')) {
        const staffN = parseInt(clef.getAttribute('number') ?? '1', 10) || 1;
        const sign = clefSign(clef);
        if (sign) clefByStaff.set(staffN, sign);
      }
    }

    const notes = listMeasureNotes(measure);
    const byVoice = new Map<string, Element[]>();
    for (const note of notes) {
      const voice = noteVoiceText(note);
      if (!byVoice.has(voice)) byVoice.set(voice, []);
      byVoice.get(voice)!.push(note);
    }

    for (const note of notes) {
      const restEl = note.querySelector(':scope > rest, :scope > *|rest');
      if (!restEl) continue;

      const noteType = noteTypeText(note);
      const isMeasureRest = restEl.getAttribute('measure') === 'yes';
      const { step, octave } = restDisplayStepOctave(restEl);
      const staffN = noteStaffN(note);
      const clef = clefByStaff.get(staffN) ?? 'G';

      if (
        (noteType === 'whole' || noteType === 'half' || isMeasureRest)
        && step
        && HIGH_REST_DISPLAY_STEPS.has(step)
      ) {
        clearRestDisplayHints(restEl);
        continue;
      }

      if (clef === 'F' && step && octave != null && octave >= 4) {
        clearRestDisplayHints(restEl);
      }
    }

    for (const voiceNotes of byVoice.values()) {
      if (!voiceNotes.every((n) => n.querySelector(':scope > rest, :scope > *|rest'))) continue;
      for (const note of voiceNotes) {
        const restEl = note.querySelector(':scope > rest, :scope > *|rest');
        if (!restEl) continue;
        const noteType = noteTypeText(note);
        const isMeasureRest = restEl.getAttribute('measure') === 'yes';
        if (noteType !== 'whole' && noteType !== '' && !isMeasureRest) continue;
        clearRestDisplayHints(restEl);
      }
    }
  }
}

/** OSMD/HITL 미리보기 전용 — Audiveris rest `display-step`/`display-octave` 힌트 제거. */
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
