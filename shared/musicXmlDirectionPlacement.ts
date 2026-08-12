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

/** Leading `<print>` / `<attributes>` / `<direction>` 블록 직후 삽입 인덱스. */
export function measureHeaderInsertIndex(meas: Element): number {
  let idx = 0;
  for (const child of [...meas.children]) {
    const name = xmlLocalName(child);
    if (name === 'print' || name === 'attributes' || name === 'direction') idx += 1;
    else break;
  }
  return idx;
}

export function directionHasTempo(dir: Element): boolean {
  for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
    if ([...dt.children].some((c) => xmlLocalName(c) === 'metronome')) return true;
  }
  return dir.querySelector(':scope > sound[tempo], :scope > *|sound[tempo]') != null;
}

function repositionMeasureDirectionsBeforeAttributes(meas: Element, tempoOnly: boolean): void {
  const children = [...meas.children];
  const firstAttr = children.findIndex((c) => xmlLocalName(c) === 'attributes');
  if (firstAttr < 0) return;
  for (let i = 0; i < firstAttr; i++) {
    const child = children[i]!;
    if (xmlLocalName(child) !== 'direction') continue;
    if (tempoOnly && !directionHasTempo(child)) continue;
    child.remove();
    const insertAt = measureHeaderInsertIndex(meas);
    if (insertAt >= meas.childElementCount) meas.appendChild(child);
    else meas.insertBefore(child, meas.children[insertAt] ?? null);
  }
}

/**
 * OSMD는 마디 첫 `<attributes>` 이전의 `<direction>`을 픽업(빈 마디)으로 해석한다.
 * HITL·inject·Audiveris 산출물을 미리보기 load 전에 `<attributes>` 뒤로 옮긴다(저장 MXL 불변).
 */
export function repositionDirectionsBeforeAttributesForOsmdPreview(
  xml: string,
  options?: { tempoOnly?: boolean },
): string {
  const tempoOnly = options?.tempoOnly ?? false;
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    for (const part of findXmlParts(doc)) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;
        repositionMeasureDirectionsBeforeAttributes(meas, tempoOnly);
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}
