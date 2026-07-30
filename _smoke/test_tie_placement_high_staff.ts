/**
 * 붙임줄 placement: F clef F3/A3(오선 상단) → above, C3 → below.
 * Run: npx tsx _smoke/test_tie_placement_high_staff.ts
 */
import { JSDOM } from 'jsdom';
import {
  middleLineDiatonic,
  normalizeTiePlacementsInMusicXml,
  tiePlacementForNote,
} from '../shared/musicXmlTiePlacement.ts';

const dom = new JSDOM('<!DOCTYPE html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
<part id="P3">
<measure number="1">
<attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
</measure>
<measure number="65">
<note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><type>whole</type>
<tie type="start"/>
<notations><tied type="start"/></notations></note>
</measure>
<measure number="66">
<note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><type>whole</type>
<tie type="stop"/>
<notations><tied type="stop"/></notations></note>
</measure>
</part>
<part id="P4">
<measure number="1">
<attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
</measure>
<measure number="65">
<note><pitch><step>F</step><octave>3</octave></pitch><duration>4</duration><type>whole</type>
<tie type="start"/>
<notations><tied type="start"/></notations></note>
</measure>
<measure number="66">
<note><pitch><step>F</step><octave>3</octave></pitch><duration>4</duration><type>whole</type>
<tie type="stop"/>
<notations><tied type="stop"/></notations></note>
</measure>
<measure number="67">
<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>whole</type><stem>up</stem>
<tie type="start"/>
<notations><tied type="start"/></notations></note>
</measure>
</part>
</score-partwise>`;

if (middleLineDiatonic('F', 4) !== 22) {
  console.error('FAIL middle F', middleLineDiatonic('F', 4));
  process.exit(1);
}

const out = normalizeTiePlacementsInMusicXml(xml);
const doc = new DOMParser().parseFromString(out, 'text/xml');

function tiedPlacements(partId: string, measureNumber: string): string[] {
  const part = [...doc.getElementsByTagName('part')].find((p) => p.getAttribute('id') === partId);
  const m = [...(part?.getElementsByTagName('measure') ?? [])].find(
    (x) => x.getAttribute('number') === measureNumber,
  );
  return [...(m?.querySelectorAll('tied') ?? [])].map((t) => t.getAttribute('placement') || '');
}

const t65 = tiedPlacements('P3', '65');
const b65 = tiedPlacements('P4', '65');
const c67 = tiedPlacements('P4', '67');
console.log({ t65, b65, c67 });

if (!t65.every((p) => p === 'above') || !b65.every((p) => p === 'above')) {
  console.error('FAIL: T/B high staff ties should be above');
  process.exit(1);
}
if (!c67.every((p) => p === 'below')) {
  console.error('FAIL: C3 stem-up should be below');
  process.exit(1);
}

// unit: F3 on F clef
const noteXml = `<note xmlns="http://www.musicxml.org/ns/partwise"><pitch><step>F</step><octave>3</octave></pitch></note>`;
const n = new DOMParser().parseFromString(noteXml, 'text/xml').documentElement;
if (tiePlacementForNote(n, 'F', 4) !== 'above') {
  console.error('FAIL tiePlacementForNote F3');
  process.exit(1);
}

console.log('tie placement high staff ok');
