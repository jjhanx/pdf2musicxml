/**
 * stop between chord members must advance past chord tail.
 * Run: npx tsx _smoke/test_wedge_stop_chord_gap_advance.ts
 */
import { JSDOM } from 'jsdom';
import { advanceWedgeStopsPastFollowingNoteInMeasure } from '../shared/musicXmlTimelineCleanup';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5"><measure number="5">
    <direction placement="below"><direction-type><wedge type="crescendo" spread="0"/></direction-type><staff>1</staff></direction>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
    <direction placement="below"><direction-type><wedge type="stop" spread="15"/></direction-type><staff>1</staff></direction>
    <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
  </measure></part>
</score-partwise>`;

const doc = parseMusicXmlDocument(xml)!;
const meas = doc.querySelector('measure')!;
advanceWedgeStopsPastFollowingNoteInMeasure(meas);
const kids = [...meas.children];
const stopI = kids.findIndex(
  (c) => c.localName === 'direction' && c.querySelector('wedge[type="stop"]'),
);
const chordI = kids.findIndex((c) => c.localName === 'note' && c.querySelector('chord'));
if (stopI <= chordI) {
  console.error('FAIL stop still before/at chord', { stopI, chordI });
  process.exit(1);
}
if (kids[stopI]?.getAttribute('data-osmd-wedge-stop-advanced') !== '1') {
  console.error('FAIL missing advanced attr');
  process.exit(1);
}
console.log('ok wedge stop advanced past chord tail');
