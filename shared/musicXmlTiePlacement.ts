/**
 * 붙임줄(`<tied>`) placement — 오선 위치·줄기 기준 (미리보기·저장 공용 규칙).
 * 오선 중선 이상(상단) → above, 줄기 down → above, 그 외 → below.
 */

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

const STEP_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

function pitchDiatonic(note: Element): number | null {
  const pitch = [...note.children].find((c) => xmlLocalName(c) === 'pitch');
  if (!pitch) return null;
  const step = [...pitch.children].find((c) => xmlLocalName(c) === 'step')?.textContent?.trim();
  const oct = [...pitch.children].find((c) => xmlLocalName(c) === 'octave')?.textContent?.trim();
  if (!step || !oct || !(step in STEP_INDEX)) return null;
  const octave = parseInt(oct, 10);
  if (!Number.isFinite(octave)) return null;
  return octave * 7 + STEP_INDEX[step]!;
}

function stemDirection(note: Element): 'up' | 'down' | '' {
  const stem = [...note.children].find((c) => xmlLocalName(c) === 'stem');
  const t = stem?.textContent?.trim();
  if (t === 'up' || t === 'down') return t;
  return '';
}

/** G2=middle B4(34), F4=middle D3(22), C3(alto)=C4(28), C4(tenor)=A3(26) */
export function middleLineDiatonic(clefSign: string, clefLine: number): number {
  const sign = clefSign.toUpperCase();
  if (sign === 'F') return 3 * 7 + 1; // D3
  if (sign === 'C') {
    if (clefLine === 4) return 3 * 7 + 5; // A3 tenor
    return 4 * 7 + 0; // C4 alto default
  }
  return 4 * 7 + 6; // B4 treble
}

export function tiePlacementForNote(
  note: Element,
  clefSign: string,
  clefLine: number,
): 'above' | 'below' {
  const dia = pitchDiatonic(note);
  const mid = middleLineDiatonic(clefSign, clefLine);
  if (dia != null && dia >= mid) return 'above';
  if (stemDirection(note) === 'down') return 'above';
  return 'below';
}

function setTiedPlacement(note: Element, placement: 'above' | 'below'): boolean {
  let changed = false;
  for (const notations of [...note.children].filter((c) => xmlLocalName(c) === 'notations')) {
    for (const tied of [...notations.children].filter((c) => xmlLocalName(c) === 'tied')) {
      if (tied.getAttribute('placement') !== placement) {
        tied.setAttribute('placement', placement);
        changed = true;
      }
      // OSMD도 orientation over/under 인식
      const wantOr = placement === 'above' ? 'over' : 'under';
      if (tied.getAttribute('orientation') && tied.getAttribute('orientation') !== wantOr) {
        tied.setAttribute('orientation', wantOr);
        changed = true;
      }
    }
  }
  for (const tie of [...note.children].filter((c) => xmlLocalName(c) === 'tie')) {
    if (tie.getAttribute('placement') !== placement) {
      tie.setAttribute('placement', placement);
      changed = true;
    }
  }
  return changed;
}

/**
 * 모든 part·마디의 붙임줄 placement를 오선 위치에 맞게 맞춤 (저장 MXL에도 동일 규칙 가능).
 */
export function normalizeTiePlacementsInMusicXml(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return xml;
    let changed = false;
    const root = doc.documentElement;
    const walkParts = (el: Element) => {
      if (xmlLocalName(el) === 'part') {
        let clefSign = 'G';
        let clefLine = 2;
        for (const measure of [...el.children].filter((c) => xmlLocalName(c) === 'measure')) {
          for (const attrs of [...measure.children].filter((c) => xmlLocalName(c) === 'attributes')) {
            for (const clef of [...attrs.children].filter((c) => xmlLocalName(c) === 'clef')) {
              const num = clef.getAttribute('number');
              if (num && num !== '1') continue;
              const sign = [...clef.children].find((c) => xmlLocalName(c) === 'sign')?.textContent?.trim();
              const line = [...clef.children].find((c) => xmlLocalName(c) === 'line')?.textContent?.trim();
              if (sign) clefSign = sign;
              if (line && /^\d+$/.test(line)) clefLine = parseInt(line, 10);
            }
          }
          for (const note of [...measure.children].filter((c) => xmlLocalName(c) === 'note')) {
            const hasTied =
              note.querySelector(':scope > notations > tied, :scope > *|notations > *|tied') != null ||
              note.querySelector(':scope > tie, :scope > *|tie') != null;
            if (!hasTied) continue;
            const plc = tiePlacementForNote(note, clefSign, clefLine);
            if (setTiedPlacement(note, plc)) changed = true;
          }
        }
        return;
      }
      for (const c of [...el.children]) walkParts(c);
    };
    walkParts(root);
    return changed ? new XMLSerializer().serializeToString(doc) : xml;
  } catch {
    return xml;
  }
}

/** @deprecated alias */
export function normalizeTiePlacementsForOsmdPreview(xml: string): string {
  return normalizeTiePlacementsInMusicXml(xml);
}
