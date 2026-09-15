/**
 * OSMD `calculateSingleOctaveShift` → `realValue` 크래시 방지.
 * 짝 없는/잘린 `<octave-shift>`는 미리보기에서 words로 바꾸거나 stop은 제거한다.
 * 저장 MXL은 변경하지 않는다.
 */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';

function localName(el: Element): string {
  return (el.localName || el.tagName || '').toLowerCase();
}

/** start → "8va"/"8vb" words, stop → 요소 제거(빈 words 잔상 방지). */
export function demoteOctaveShiftsForOsmdPreview(xml: string): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return xml;

  const shifts = [...doc.querySelectorAll('*')].filter((el) => localName(el) === 'octave-shift');
  for (const el of shifts) {
    const typ = (el.getAttribute('type') || '').trim().toLowerCase();
    if (typ === 'up' || typ === 'down') {
      const words = el.namespaceURI
        ? doc.createElementNS(el.namespaceURI, 'words')
        : doc.createElement('words');
      words.textContent = typ === 'up' ? '8va' : '8vb';
      el.replaceWith(words);
      continue;
    }
    // stop / continue / unknown — 부모 direction-type만 비면 direction 전체 제거
    const dtype = el.parentElement;
    el.remove();
    if (dtype && localName(dtype) === 'direction-type' && dtype.childElementCount === 0) {
      const direction = dtype.parentElement;
      dtype.remove();
      if (direction && localName(direction) === 'direction') {
        const stillHasType = [...direction.children].some((c) => localName(c) === 'direction-type');
        if (!stillHasType) direction.remove();
      }
    }
  }
  return serializeMusicXmlDocument(doc);
}
