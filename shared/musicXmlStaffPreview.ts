/** OSMD staff(PR/PL) 필터 미리보기 — cross-staff timeline 정리. */

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function noteStaffN(noteEl: Element): number {
  const staffEl = noteEl.querySelector(':scope > staff, :scope > *|staff');
  if (!staffEl) return 1;
  const n = parseInt(staffEl.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
}

function noteVoiceText(noteEl: Element): string {
  return noteEl.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || '1';
}

function forwardVoiceText(fwd: Element): string | null {
  const text = fwd.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
  return text || null;
}

/** forward voice가 이 staff에 남은 note voice와 맞는가 (PR 잔여 forward가 PL을 밀지 않게). */
function forwardMatchesStaffVoice(measure: Element, fwd: Element, staffN: number, fromIdx: number): boolean {
  const fwdVoice = forwardVoiceText(fwd);
  if (!fwdVoice) {
    // voice 없는 선두 forward는 다음 staff note가 있으면 유지(보조 onset)
    for (let j = fromIdx + 1; j < measure.children.length; j += 1) {
      const c = measure.children[j]!;
      if (xmlLocalName(c) === 'note' && noteStaffN(c) === staffN) return true;
    }
    return false;
  }
  for (let j = fromIdx + 1; j < measure.children.length; j += 1) {
    const c = measure.children[j]!;
    if (xmlLocalName(c) !== 'note') continue;
    if (noteStaffN(c) !== staffN) continue;
    if (noteVoiceText(c) === fwdVoice) return true;
  }
  return false;
}

/**
 * 한 마디를 part 내 특정 staff(1=PR, 2=PL) 단일 줄로 — cross-staff backup/forward 제거.
 * 마디 맨 앞 `<forward>`(보조 voice onset)는 **같은 staff·같은 voice**의 첫 note 앞이면 유지.
 * PR voice용 `forward`(예: v2, 2분)가 PL note 앞에 남으면 OSMD가 PL을 반박 늦게 그림.
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
      if (!forwardMatchesStaffVoice(measure, child, staffN, idx)) {
        child.remove();
      }
      continue;
    }
    if (prevStaff === null || prevStaff !== staffN) {
      child.remove();
    }
  }
}

