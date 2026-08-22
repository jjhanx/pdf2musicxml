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
 * OSMD는 `<direction-type>` 없이 `<sound tempo>`만 있으면 길이 0 pickup 마디를 만들고
 * 그 파트(또는 정렬된 전체 악보)의 첫 마디 음표를 버린다. 미리보기에서 metronome을 보충한다.
 */
export function ensureMetronomeOnSoundTempoDirectionsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    const ns = doc.documentElement.namespaceURI;
    const mk = (local: string) => (ns ? doc.createElementNS(ns, local) : doc.createElement(local));
    for (const part of findXmlParts(doc)) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;
        for (const dir of [...meas.children].filter((c) => xmlLocalName(c) === 'direction')) {
          const sound = [...dir.children].find(
            (c) => xmlLocalName(c) === 'sound' && c.getAttribute('tempo'),
          );
          if (!sound) continue;
          let hasMetro = false;
          for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
            if ([...dt.children].some((c) => xmlLocalName(c) === 'metronome')) {
              hasMetro = true;
              break;
            }
          }
          if (hasMetro) continue;
          const bpm = sound.getAttribute('tempo')?.trim() || '120';
          const dtype = mk('direction-type');
          const metro = mk('metronome');
          metro.setAttribute('parentheses', 'no');
          const beat = mk('beat-unit');
          beat.textContent = 'quarter';
          const pm = mk('per-minute');
          pm.textContent = bpm;
          metro.appendChild(beat);
          metro.appendChild(pm);
          dtype.appendChild(metro);
          dir.insertBefore(dtype, dir.firstChild);
          if (!dir.getAttribute('print-object')) dir.setAttribute('print-object', 'no');
        }
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
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

const DYNAMICS_TAG_NAMES = new Set([
  'p', 'pp', 'ppp', 'pppp', 'ppppp', 'pppppp',
  'f', 'ff', 'fff', 'ffff', 'fffff', 'ffffff',
  'mp', 'mf', 'sf', 'sfp', 'sfpp', 'fp', 'rf', 'rfz', 'sfz', 'sffz', 'fz', 'n', 'pf'
]);

/**
 * OSMD 미리보기 전용:
 * 1. note/notations 안의 dynamics를 독립 <direction>으로 마이그레이션하여
 *    동일 onset에서 wedge가 누락되는 OSMD 충돌 버그 방지.
 * 2. dynamics 및 wedge에 default-y 여백(above: 25, below: -65) 보장.
 * 3. 동일 onset에서 dynamics가 wedge start보다 앞에 오도록 순서 정돈 (p > 순서).
 */
export function normalizeDynamicsAndWedgesForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    const ns = doc.documentElement.namespaceURI;
    const mk = (local: string) => (ns ? doc.createElementNS(ns, local) : doc.createElement(local));

    for (const part of findXmlParts(doc)) {
      for (const meas of [...part.children]) {
        if (xmlLocalName(meas) !== 'measure') continue;

        // 1. 음표의 notations/dynamics를 <direction>으로 변환
        for (const note of [...meas.children].filter((c) => xmlLocalName(c) === 'note')) {
          const notations = [...note.children].find((c) => xmlLocalName(c) === 'notations');
          if (!notations) continue;
          for (const dyn of [...notations.children].filter((c) => xmlLocalName(c) === 'dynamics')) {
            const pl = dyn.getAttribute('placement') || 'above';
            const staffEl = [...note.children].find((c) => xmlLocalName(c) === 'staff');
            const staffNum = staffEl?.textContent?.trim() || '1';

            const dynChildren = [...dyn.children].filter((c) => DYNAMICS_TAG_NAMES.has(xmlLocalName(c)));
            for (const dc of dynChildren) {
              const dir = mk('direction');
              dir.setAttribute('placement', pl);
              dir.setAttribute('default-y', pl === 'above' ? '45' : '-65');
              const dt = mk('direction-type');
              const dynNew = mk('dynamics');
              dynNew.setAttribute('placement', pl);
              dynNew.setAttribute('default-y', pl === 'above' ? '45' : '-65');
              dynNew.appendChild(mk(xmlLocalName(dc)));
              dt.appendChild(dynNew);
              dir.appendChild(dt);

              const stNew = mk('staff');
              stNew.textContent = staffNum;
              dir.appendChild(stNew);

              meas.insertBefore(dir, note);
            }
            dyn.remove();
          }
          if (notations.childElementCount === 0) {
            notations.remove();
          }
        }

        // 2. 모든 direction dynamics / wedge에 default-y 부여
        for (const dir of [...meas.children].filter((c) => xmlLocalName(c) === 'direction')) {
          const pl = dir.getAttribute('placement') || 'below';
          for (const dt of [...dir.children].filter((c) => xmlLocalName(c) === 'direction-type')) {
            for (const child of [...dt.children]) {
              const cName = xmlLocalName(child);
              if (cName === 'dynamics' || cName === 'wedge') {
                if (pl === 'above') {
                  if (!dir.getAttribute('default-y')) dir.setAttribute('default-y', '45');
                  if (!child.getAttribute('default-y')) child.setAttribute('default-y', '45');
                } else if (pl === 'below') {
                  if (!dir.getAttribute('default-y')) dir.setAttribute('default-y', '-65');
                  if (!child.getAttribute('default-y')) child.setAttribute('default-y', '-65');
                }
              }
            }
          }
        }

        // 3. 동일 onset에서 dynamics가 wedge start보다 앞에 오도록 순서 정돈 (p > 순서)
        const children = [...meas.children];
        for (let i = 0; i < children.length - 1; i++) {
          const c1 = children[i]!;
          const c2 = children[i + 1]!;
          if (xmlLocalName(c1) === 'direction' && xmlLocalName(c2) === 'direction') {
            const hasWedgeStart = [...c1.querySelectorAll('wedge')].some((w) =>
              ['crescendo', 'diminuendo'].includes(w.getAttribute('type') || '')
            );
            const hasDyn = c2.querySelector('dynamics') !== null;
            if (hasWedgeStart && hasDyn) {
              meas.insertBefore(c2, c1);
            }
          }
        }
      }
    }
    return serializeMusicXmlDocument(doc);
  } catch {
    return xml;
  }
}

