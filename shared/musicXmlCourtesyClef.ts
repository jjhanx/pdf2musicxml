/**
 * OSMD 미리보기: 줄바꿈 courtesy로 반복되는 머리 음자리표만 제거.
 * 마디 중간(첫 note 이후) clef는 HITL 전환이므로 보존.
 */

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

function previewClefSign(clef: Element): string {
  return clef.querySelector('sign, *|sign')?.textContent?.trim() ?? '';
}

function previewClefSignBefore(part: Element, measureNum: number, staffNum: number): string {
  let current = 'G';
  for (const meas of [...part.children]) {
    if (xmlLocalName(meas) !== 'measure') continue;
    const mn = parseInt(meas.getAttribute('number') ?? '0', 10);
    if (mn >= measureNum) break;
    for (const attr of [...meas.children]) {
      if (xmlLocalName(attr) !== 'attributes') continue;
      for (const clef of [...attr.children].filter((c) => xmlLocalName(c) === 'clef')) {
        const numAttr = clef.getAttribute('number');
        const cStaff = numAttr && /^\d+$/.test(numAttr) ? parseInt(numAttr, 10) : 1;
        if (cStaff !== staffNum) continue;
        const sign = previewClefSign(clef);
        if (sign) current = sign;
      }
    }
  }
  return current;
}

/** 줄바꿈 등에서 이전과 동일한 머리 `<clef>` courtesy 반복 제거 — OSMD 미리보기 전용. */
export function removeRedundantCourtesyClefsForOsmd(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;

    for (const part of findXmlParts(doc)) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;
        const mnum = parseInt(meas.getAttribute('number') ?? '0', 10);
        let seenNote = false;
        for (const child of [...meas.children]) {
          const tag = xmlLocalName(child);
          if (tag === 'note') {
            seenNote = true;
            continue;
          }
          if (tag !== 'attributes') continue;
          // mid-measure clef — HITL 전환. courtesy 제거 대상 아님.
          if (seenNote) continue;
          for (const clef of [...child.children].filter((c) => xmlLocalName(c) === 'clef')) {
            const numAttr = clef.getAttribute('number');
            const staff = numAttr && /^\d+$/.test(numAttr) ? parseInt(numAttr, 10) : 1;
            const sign = previewClefSign(clef);
            if (!sign) continue;
            if (sign === previewClefSignBefore(part, mnum, staff)) clef.remove();
          }
          if (![...child.children].length) child.remove();
        }
      }
    }

    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}
