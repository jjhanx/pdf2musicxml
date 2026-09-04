/**
 * OSMD 미리보기: 이미 유효한 음자리표와 내용이 같은 `<clef>` 제거.
 * - 마디 머리 courtesy 반복
 * - 마디 중간·끝의 동일 반복(Audiveris 예고/중복)
 * 실제 전환(G↔F 등 sign·line·octave-change 변경)은 보존.
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

function childText(parent: Element, name: string): string {
  for (const c of [...parent.children]) {
    if (xmlLocalName(c) === name) return (c.textContent || '').trim();
  }
  return '';
}

/** staff → "sign|line|octaveChange" */
function clefIdentity(clef: Element): string | null {
  const sign = childText(clef, 'sign').toUpperCase();
  if (!sign) return null;
  const lineRaw = childText(clef, 'line');
  const line =
    lineRaw && /^\d+$/.test(lineRaw) ? lineRaw : sign === 'F' ? '4' : sign === 'C' ? '3' : '2';
  const octRaw = childText(clef, 'clef-octave-change');
  const oct = octRaw && /^-?\d+$/.test(octRaw) ? octRaw : '0';
  return `${sign}|${line}|${oct}`;
}

function clefStaffNumber(clef: Element): number {
  const numAttr = clef.getAttribute('number');
  if (numAttr && /^\d+$/.test(numAttr)) return parseInt(numAttr, 10);
  return 1;
}

/**
 * 이미 적용된 음자리표와 동일하면 제거(머리 courtesy·중간·끝 중복).
 * 해당 staff에서 첫 clef는 유지. sign·line·octave-change 전환만 남김.
 */
export function removeRedundantCourtesyClefsForOsmd(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return xml;

    let changed = false;
    for (const part of findXmlParts(doc)) {
      const active = new Map<number, string>();
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;
        for (const child of [...meas.children]) {
          if (xmlLocalName(child) !== 'attributes') continue;
          for (const clef of [...child.children].filter((c) => xmlLocalName(c) === 'clef')) {
            const staff = clefStaffNumber(clef);
            const id = clefIdentity(clef);
            if (!id) continue;
            const prev = active.get(staff);
            if (prev !== undefined && id === prev) {
              clef.remove();
              changed = true;
            } else {
              active.set(staff, id);
            }
          }
          if (![...child.children].length) {
            child.remove();
            changed = true;
          }
        }
      }
    }

    return changed ? new XMLSerializer().serializeToString(doc) : xml;
  } catch {
    return xml;
  }
}
