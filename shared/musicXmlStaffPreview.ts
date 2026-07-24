/** OSMD staff(PR/PL) 필터 미리보기 — cross-staff timeline 정리. */

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function noteStaffN(noteEl: Element): number {
  const staffEl = noteEl.querySelector(':scope > staff, :scope > *|staff');
  if (!staffEl) return 1;
  const n = parseInt(staffEl.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
}

/**
 * 한 마디를 part 내 특정 staff(1=PR, 2=PL) 단일 줄로 — cross-staff backup/forward 제거.
 * 마디 맨 앞 `<forward>`(보조 voice onset)는 같은 staff의 첫 note 앞이면 유지.
 */
export function pruneCrossStaffTimelineForOsmdPreview(measure: Element, staffN: number): void {
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag !== 'backup' && tag !== 'forward') continue;
    const idx = [...measure.children].indexOf(child);
    if (idx < 0) continue;
    let prevStaff: number | null = null;
    for (let j = idx - 1; j >= 0; j -= 1) {
      const c = measure.children[j]!;
      if (xmlLocalName(c) === 'note') {
        prevStaff = noteStaffN(c);
        break;
      }
    }
    let nextStaff: number | null = null;
    for (let j = idx + 1; j < measure.children.length; j += 1) {
      const c = measure.children[j]!;
      if (xmlLocalName(c) === 'note') {
        nextStaff = noteStaffN(c);
        break;
      }
    }
    if (nextStaff !== staffN) {
      child.remove();
      continue;
    }
    if (tag === 'forward' && prevStaff === null) {
      continue;
    }
    if (prevStaff === null || prevStaff !== staffN) {
      child.remove();
    }
  }
}
