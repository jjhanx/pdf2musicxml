/**
 * MusicXML 음표 간 임시표(#, b, ♮) 상태 전파 및 제자리표(cautionary natural) 보충 모듈.
 *
 * 규칙:
 * 1. 각 파트 및 오선(staff)별로 음표(일반 음표 및 꾸밈음)의 반음 올림/내림 상태(alter)를 추적한다.
 * 2. 선행 음표나 직전 마디에서 임시표로 인해 피치가 변경되었던 경우(예: m43 grace G#4),
 *    다음 음표가 조표 기준(예: G natural)으로 복귀할 때 명시적 제자리표(<accidental>natural</accidental>)를 부착한다.
 * 3. 피치에 alter가 지정되었으나 accidental 태그가 누락된 경우, MusicXML 규격 순서에 맞게 accidental 요소를 보충한다.
 * 4. 조표(<key><fifths>)가 변경되면 해당 오선의 임시표 상태는 새 조표 기준으로 초기화된다.
 * 5. alter와 모순되는 accidental(음높이만 고치고 남은 옛 표기)은 alter 기준으로 바로잡는다.
 */

function getExpectedAlterFromFifths(step: string, fifths: number): number {
  const sharpOrder = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const flatOrder = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  if (fifths > 0 && sharpOrder.slice(0, fifths).includes(step)) return 1;
  if (fifths < 0 && flatOrder.slice(0, -fifths).includes(step)) return -1;
  return 0;
}

const ACCIDENTAL_PRECEDING_TAGS = new Set([
  'time-modification',
  'stem',
  'notehead',
  'notehead-text',
  'staff',
  'beam',
  'notations',
  'lyric',
]);

function insertAccidentalElement(note: Element, accEl: Element): void {
  for (const child of Array.from(note.children)) {
    const local = child.localName || child.tagName;
    if (ACCIDENTAL_PRECEDING_TAGS.has(local)) {
      note.insertBefore(accEl, child);
      return;
    }
  }
  note.appendChild(accEl);
}

const ACCIDENTAL_ALTER: Record<string, number> = {
  sharp: 1,
  flat: -1,
  natural: 0,
  'double-sharp': 2,
  'sharp-sharp': 2,
  'flat-flat': -2,
};
const ALTER_ACCIDENTAL: Record<number, string> = {
  1: 'sharp',
  [-1]: 'flat',
  0: 'natural',
  2: 'double-sharp',
  [-2]: 'flat-flat',
};

/**
 * `<alter>`(소리)와 모순되는 표준 `<accidental>`(예: alter=-1 + natural)은 음높이 수정 전 표기의 찌꺼기.
 * OSMD는 표기를 믿고 다른 음(A♭→A♮)으로 그리므로 alter에 맞는 기호로 바꾼다(속성 유지).
 */
function syncStaleAccidentalToAlter(accEl: Element | null, noteAlter: number): void {
  const text = accEl?.textContent?.trim();
  if (!accEl || !text) return;
  const implied = ACCIDENTAL_ALTER[text];
  const wanted = ALTER_ACCIDENTAL[noteAlter];
  if (implied === undefined || wanted === undefined || implied === noteAlter) return;
  accEl.textContent = wanted;
}

export function propagateAccidentalStatesForMusicXml(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return xml;

    const parts = doc.querySelectorAll('part');
    for (const part of Array.from(parts)) {
      let currentFifths = 0;
      let prevMeasureAlters = new Map<string, number>();

      const measures = part.querySelectorAll(':scope > measure');
      for (const meas of Array.from(measures)) {
        const fifthsEl = meas.querySelector('attributes > key > fifths');
        if (fifthsEl?.textContent?.trim()) {
          const nf = parseInt(fifthsEl.textContent.trim(), 10);
          if (!isNaN(nf) && nf !== currentFifths) {
            currentFifths = nf;
            prevMeasureAlters.clear();
          }
        }

        const currMeasureAlters = new Map<string, number>();
        const notes = meas.querySelectorAll(':scope > note');

        for (const note of Array.from(notes)) {
          if (note.querySelector(':scope > rest')) continue;
          const pitch = note.querySelector(':scope > pitch');
          if (!pitch) continue;

          const step = pitch.querySelector(':scope > step')?.textContent?.trim()?.toUpperCase();
          const octText = pitch.querySelector(':scope > octave')?.textContent?.trim();
          if (!step || !octText) continue;
          const octave = parseInt(octText, 10);
          if (isNaN(octave)) continue;

          const staffText = note.querySelector(':scope > staff')?.textContent?.trim();
          const staff = staffText && /^\d+$/.test(staffText) ? parseInt(staffText, 10) : 1;

          const alterText = pitch.querySelector(':scope > alter')?.textContent?.trim();
          const accEl = note.querySelector(':scope > accidental');

          let noteAlter = 0;
          if (alterText && /^-?\d+$/.test(alterText)) {
            noteAlter = parseInt(alterText, 10);
            syncStaleAccidentalToAlter(accEl, noteAlter);
          } else if (accEl?.textContent?.trim()) {
            const at = accEl.textContent.trim();
            if (at === 'sharp') noteAlter = 1;
            else if (at === 'flat') noteAlter = -1;
            else if (at === 'natural') noteAlter = 0;
            else if (at === 'double-sharp') noteAlter = 2;
            else if (at === 'flat-flat') noteAlter = -2;
          }

          const key = `${staff}:${step}${octave}`;
          const expectedFromKey = getExpectedAlterFromFifths(step, currentFifths);

          let isTieStop = false;
          for (const t of Array.from(note.querySelectorAll(':scope > tie'))) {
            if (t.getAttribute('type') === 'stop') isTieStop = true;
          }
          for (const t of Array.from(note.querySelectorAll(':scope > notations > tied'))) {
            if (t.getAttribute('type') === 'stop') isTieStop = true;
          }

          let activeAlter: number;
          if (currMeasureAlters.has(key)) {
            activeAlter = currMeasureAlters.get(key)!;
          } else if (prevMeasureAlters.has(key)) {
            activeAlter = prevMeasureAlters.get(key)!;
          } else {
            activeAlter = expectedFromKey;
          }

          if (!isTieStop && noteAlter !== activeAlter) {
            if (!accEl) {
              let needed: string | null = null;
              if (noteAlter === expectedFromKey) {
                needed = expectedFromKey === 0 ? 'natural' : expectedFromKey > 0 ? 'sharp' : 'flat';
              } else if (noteAlter === 1) {
                needed = 'sharp';
              } else if (noteAlter === -1) {
                needed = 'flat';
              } else if (noteAlter === 2) {
                needed = 'double-sharp';
              } else if (noteAlter === -2) {
                needed = 'flat-flat';
              }

              if (needed) {
                const ns = note.namespaceURI;
                const newAcc = ns ? doc.createElementNS(ns, 'accidental') : doc.createElement('accidental');
                newAcc.textContent = needed;
                insertAccidentalElement(note, newAcc);
              }
            }
          }

          currMeasureAlters.set(key, noteAlter);
        }

        prevMeasureAlters = currMeasureAlters;
      }
    }

    return new XMLSerializer().serializeToString(doc);
  } catch {
    return xml;
  }
}
