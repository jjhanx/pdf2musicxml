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
