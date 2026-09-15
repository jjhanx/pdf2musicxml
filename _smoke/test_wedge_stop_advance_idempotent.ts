import { JSDOM } from 'jsdom';
import { normalizeDynamicsAndWedgesForOsmdPreview } from '../shared/musicXmlDirectionPlacement';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const raw = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions></attributes>
    <direction><direction-type><wedge type="diminuendo" number="1"/></direction-type></direction>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    <direction><direction-type><wedge type="stop" number="1"/></direction-type></direction>
    <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure></part>
</score-partwise>`;

function stopAfterNoteIndex(xml: string): number {
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  const m = d.querySelector('measure')!;
  const kids = [...m.children];
  const si = kids.findIndex(
    (c) => c.localName === 'direction' && c.querySelector('wedge[type="stop"]'),
  );
  let noteCount = 0;
  let after = -1;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]!;
    if (c.localName === 'note' && !c.querySelector('chord')) {
      if (i < si) after = noteCount;
      noteCount += 1;
    }
  }
  return after;
}

const once = normalizeDynamicsAndWedgesForOsmdPreview(raw);
const twice = normalizeDynamicsAndWedgesForOsmdPreview(once);
const a = stopAfterNoteIndex(once);
const b = stopAfterNoteIndex(twice);
console.log({ onceAfterNote: a, twiceAfterNote: b });
if (a !== 2) {
  console.error('expected stop after note index 2 (0-based), got', a);
  process.exit(1);
}
if (a !== b) {
  console.error('not idempotent', a, b);
  process.exit(1);
}
console.log('ok idempotent advance');
