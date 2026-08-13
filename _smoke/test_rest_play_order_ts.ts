/**
 * Run: npx tsx _smoke/test_rest_play_order_ts.ts
 */
import { JSDOM } from 'jsdom';
import {
  ensureRestPlayOrdersInMeasure,
  HITL_PLAY_ORDER_ATTR,
  readPlayOrder,
} from '../shared/musicXmlPlayOrder';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer =
  dom.window.XMLSerializer;

const XML = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
      <note><rest/><duration>2</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const doc = parseMusicXmlDocument(XML)!;
const meas = doc.querySelector('measure')!;
const notes = [...meas.querySelectorAll('note')];
notes[0]!.setAttribute(HITL_PLAY_ORDER_ATTR, '1');
notes[2]!.setAttribute(HITL_PLAY_ORDER_ATTR, '2');
if (!ensureRestPlayOrdersInMeasure(meas)) {
  console.error('expected rebuild');
  process.exit(1);
}
if (readPlayOrder(notes[1]!) !== 2) {
  console.error('rest should be order 2', readPlayOrder(notes[1]!));
  process.exit(1);
}
if (readPlayOrder(notes[2]!) !== 3) {
  console.error('E4 should shift to 3', readPlayOrder(notes[2]!));
  process.exit(1);
}
console.log('OK: TS rest play-order rebuild');
