/**
 * OSMD 미리보기: 이미 유효한 음자리표와 내용이 같은 `<clef>` 제거.
 * - 마디 머리 courtesy 반복
 * - 마디 중간·끝의 동일 반복(Audiveris 예고/중복)
 * 실제 전환(G↔F 등 sign·line·octave-change 변경)은 보존.
 *
 * mid 전환이 있는 마디에서는 머리 clef를 지우지 않음(없으면 직전 clef 주입).
 * 머리만 지우면 OSMD가 mid F를 마디 시작 clef로 끌어올려 앞 음까지 F로 그림.
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

function parseClefIdentity(id: string): { sign: string; line: string; oct: string } {
  const [sign, line, oct] = id.split('|');
  return { sign: sign || 'G', line: line || '2', oct: oct || '0' };
}

function clefStaffNumber(clef: Element): number {
  const numAttr = clef.getAttribute('number');
  if (numAttr && /^\d+$/.test(numAttr)) return parseInt(numAttr, 10);
  return 1;
}

function mk(doc: Document, parent: Element, local: string): Element {
  const ns = parent.namespaceURI;
  return ns ? doc.createElementNS(ns, local) : doc.createElement(local);
}

/** 마디 시작 시점 active 대비 mid clef가 바뀌는 staff — 머리 clef 유지/주입 대상. */
function staffsWithMidClefChange(
  measure: Element,
  activeAtStart: Map<number, string>,
): Set<number> {
  const need = new Set<number>();
  let seenNote = false;
  const headerByStaff = new Map<number, string>();
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'note') {
      seenNote = true;
      continue;
    }
    if (tag !== 'attributes') continue;
    for (const clef of [...child.children].filter((c) => xmlLocalName(c) === 'clef')) {
      const staff = clefStaffNumber(clef);
      const id = clefIdentity(clef);
      if (!id) continue;
      if (!seenNote) {
        headerByStaff.set(staff, id);
        continue;
      }
      const base = headerByStaff.get(staff) ?? activeAtStart.get(staff);
      if (base === undefined || id !== base) need.add(staff);
    }
  }
  return need;
}

function headerHasClefForStaff(measure: Element, staff: number): boolean {
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note') return false;
    if (xmlLocalName(child) !== 'attributes') continue;
    for (const clef of [...child.children].filter((c) => xmlLocalName(c) === 'clef')) {
      if (clefStaffNumber(clef) === staff) return true;
    }
  }
  return false;
}

function ensureHeaderClef(measure: Element, staff: number, identity: string): boolean {
  if (headerHasClefForStaff(measure, staff)) return false;
  const { sign, line, oct } = parseClefIdentity(identity);
  const doc = measure.ownerDocument;
  if (!doc) return false;

  let headerAttrs: Element | null = null;
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note') break;
    if (xmlLocalName(child) === 'attributes') {
      headerAttrs = child;
      break;
    }
  }
  if (!headerAttrs) {
    headerAttrs = mk(doc, measure, 'attributes');
    const firstNote = [...measure.children].find((c) => xmlLocalName(c) === 'note');
    if (firstNote) measure.insertBefore(headerAttrs, firstNote);
    else measure.insertBefore(headerAttrs, measure.firstChild);
  }

  const clef = mk(doc, headerAttrs, 'clef');
  clef.setAttribute('number', String(staff));
  const signEl = mk(doc, clef, 'sign');
  signEl.textContent = sign;
  clef.appendChild(signEl);
  const lineEl = mk(doc, clef, 'line');
  lineEl.textContent = line;
  clef.appendChild(lineEl);
  if (oct !== '0') {
    const octEl = mk(doc, clef, 'clef-octave-change');
    octEl.textContent = oct;
    clef.appendChild(octEl);
  }
  headerAttrs.appendChild(clef);
  return true;
}

/**
 * 이미 적용된 음자리표와 동일하면 제거(머리 courtesy·중간·끝 중복).
 * mid 전환이 있는 마디의 머리 clef는 유지(없으면 직전 값 주입).
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
        const activeAtStart = new Map(active);
        const keepHeader = staffsWithMidClefChange(meas, activeAtStart);

        for (const staff of keepHeader) {
          const inherited = activeAtStart.get(staff);
          if (inherited && ensureHeaderClef(meas, staff, inherited)) changed = true;
        }

        let seenNote = false;
        for (const child of [...meas.children]) {
          const tag = xmlLocalName(child);
          if (tag === 'note') {
            seenNote = true;
            continue;
          }
          if (tag !== 'attributes') continue;
          for (const clef of [...child.children].filter((c) => xmlLocalName(c) === 'clef')) {
            const staff = clefStaffNumber(clef);
            const id = clefIdentity(clef);
            if (!id) continue;
            const prev = active.get(staff);
            if (prev !== undefined && id === prev) {
              // mid 전환 마디: 머리 clef는 OSMD가 mid를 앞으로 끌어올리지 않도록 유지
              if (!seenNote && keepHeader.has(staff)) continue;
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
