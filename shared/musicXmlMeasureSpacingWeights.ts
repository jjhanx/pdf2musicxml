/**
 * OSMD 미리보기 — 마디 폭 가중치(박자표 최소 슬롯 · 음표/쉼표 수).
 * 4/4 → min 4, 6/8 → min 8 (beat-type). 저장 MXL 불변.
 */
export function xmlLocalName(el: Element): string {
  return (el.localName || el.tagName).toLowerCase().replace(/^.*:/, '');
}

function isGraceNote(note: Element): boolean {
  return note.querySelector(':scope > grace, :scope > *|grace') !== null;
}

function isChordMember(note: Element): boolean {
  return note.querySelector(':scope > chord, :scope > *|chord') !== null;
}

/** 음표·쉼표 이벤트 수(꾸밈음·화음 멤버 제외 = column 수). */
export function countMeasureNoteRestEvents(measure: Element): number {
  let n = 0;
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'note') continue;
    if (isGraceNote(child)) continue;
    if (isChordMember(child)) continue;
    n += 1;
  }
  return n;
}

/** 박자표 분모(beat-type). 4/4→4, 6/8→8. attributes 없으면 null. */
export function readMeasureBeatType(measure: Element): number | null {
  for (const attr of [...measure.children]) {
    if (xmlLocalName(attr) !== 'attributes') continue;
    const timeEl = attr.querySelector(':scope > time, :scope > *|time');
    if (!timeEl) continue;
    const bt = timeEl.querySelector(':scope > beat-type, :scope > *|beat-type')?.textContent?.trim();
    if (bt && /^\d+$/.test(bt)) return Math.max(1, parseInt(bt, 10));
  }
  return null;
}

export function readMeasureBeats(measure: Element): number | null {
  for (const attr of [...measure.children]) {
    if (xmlLocalName(attr) !== 'attributes') continue;
    const timeEl = attr.querySelector(':scope > time, :scope > *|time');
    if (!timeEl) continue;
    const b = timeEl.querySelector(':scope > beats, :scope > *|beats')?.textContent?.trim();
    if (b && /^\d+$/.test(b)) return Math.max(1, parseInt(b, 10));
  }
  return null;
}

/**
 * 마디 공간 가중치 = max(박자표 최소 슬롯, 음표·쉼표 수).
 * 최소 슬롯 = beat-type(4/4→4, 6/8→8).
 */
export function measureSpacingWeight(
  measure: Element,
  carriedBeatType: number = 4,
): { weight: number; beatType: number; events: number } {
  const bt = readMeasureBeatType(measure) ?? carriedBeatType;
  const events = countMeasureNoteRestEvents(measure);
  const minSlots = Math.max(1, bt);
  return { weight: Math.max(minSlots, events), beatType: bt, events };
}

/**
 * part별·마디번호별 가중치. 다성부는 같은 마디에서 max(weight).
 * 반환: measureNumber → weight, beatType 캐리 포함.
 */
export function collectMeasureSpacingWeightsFromXml(xml: string): Map<number, number> {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const byMeasure = new Map<number, number>();
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    let carriedBt = 4;
    for (const child of [...part.children]) {
      if (xmlLocalName(child) !== 'measure') continue;
      const mn = parseInt(child.getAttribute('number') || '', 10);
      if (!Number.isFinite(mn)) continue;
      const { weight, beatType } = measureSpacingWeight(child, carriedBt);
      carriedBt = beatType;
      const prev = byMeasure.get(mn);
      byMeasure.set(mn, prev == null ? weight : Math.max(prev, weight));
    }
  }
  return byMeasure;
}
