/**
 * flattenNonOverlappingStaffVoicesForOsmd가 템포 direction 뒤에 note를 재삽입하는지 확인.
 * Run: npx tsx _smoke/test_measure_musical_content_insert.ts
 */
import { JSDOM } from 'jsdom';
import { measureHeaderInsertIndex } from '../shared/musicXmlDirectionPlacement';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const doc = dom.window.document;
const NS = 'http://www.musicxml.org/ns/partwise';

function el(local: string, text?: string): Element {
  const e = doc.createElementNS(NS, local);
  if (text != null) e.textContent = text;
  return e;
}

const meas = el('measure');
meas.setAttribute('number', '1');
meas.appendChild(el('print'));
const attr = el('attributes');
attr.appendChild(el('divisions', '2'));
meas.appendChild(attr);
const dir = el('direction');
const dt = el('direction-type');
const metro = el('metronome');
metro.appendChild(el('per-minute', '72'));
dt.appendChild(metro);
dir.appendChild(dt);
const sound = el('sound');
sound.setAttribute('tempo', '72');
dir.appendChild(sound);
meas.appendChild(dir);
const n1 = el('note');
n1.appendChild(el('duration', '2'));
meas.appendChild(n1);
const n2 = el('note');
n2.appendChild(el('duration', '2'));
meas.appendChild(n2);

const insertAt = measureHeaderInsertIndex(meas);
const tags = [...meas.children].map((c) => c.localName);
console.log('children:', tags.join(','));
console.log('insertAt:', insertAt, 'tag at insert:', tags[insertAt]);

if (tags[insertAt] !== 'note') {
  console.error('FAIL: musical content should insert at first note, not', tags[insertAt]);
  process.exit(1);
}
console.log('OK: tempo direction stays before notes for flatten re-insert');
