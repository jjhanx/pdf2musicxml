/**
 * PL (staff2) F whole + trailing G after insertClef-like XML:
 * preview anchor must refine divisions (not leave width-0 clef at measure start).
 * Run: npx tsx _smoke/test_pl_whole_trailing_g_clef.ts
 */
import { JSDOM } from 'jsdom';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';
import { removeRedundantCourtesyClefsForOsmd } from '../shared/musicXmlCourtesyClef';
import {
  anchorTrailingMidClefsForOsmdPreview,
  anchorTrailingMidClefsInMeasure,
} from '../shared/musicXmlMidClefOsmdAnchor';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

function local(el: Element) {
  return (el.localName || el.tagName).toLowerCase();
}
function noteStaffN(note: Element) {
  const n = parseInt(note.querySelector(':scope > staff')?.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
}

const RAW = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="52">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>4</duration><type>whole</type><voice>2</voice><staff>2</staff></note>
      <attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
    </measure>
  </part>
</score-partwise>`;

let xml = repairTimelineForOsmdPreview(RAW, { faithfulEditorLayout: true });
const doc = new DOMParser().parseFromString(xml, 'application/xml');
const measure = doc.querySelector('measure')!;
let seenNote = false;
for (const child of [...measure.children]) {
  const tag = local(child);
  if (tag === 'note') {
    seenNote = true;
    continue;
  }
  if (tag !== 'attributes') continue;
  if (!seenNote) {
    let st = [...child.children].find((c) => local(c) === 'staves');
    if (!st) {
      st = child.ownerDocument!.createElement('staves');
      child.insertBefore(st, child.firstChild);
    }
    st.textContent = '1';
  }
  for (const clef of [...child.children].filter((c) => local(c) === 'clef')) {
    const num = parseInt(clef.getAttribute('number') ?? '', 10);
    if (Number.isFinite(num) && num !== 2) clef.remove();
    else if (clef.getAttribute('number')) clef.setAttribute('number', '1');
  }
}
for (const c of [...measure.children]) {
  if (local(c) === 'note' && noteStaffN(c) !== 2) c.remove();
}
pruneCrossStaffTimelineForOsmdPreview(measure, 2);
measure.querySelectorAll('note staff').forEach((el) => {
  el.textContent = '1';
});
anchorTrailingMidClefsInMeasure(measure);
xml = new XMLSerializer().serializeToString(doc);
xml = removeRedundantCourtesyClefsForOsmd(xml);
xml = anchorTrailingMidClefsForOsmdPreview(xml);

const m = new DOMParser().parseFromString(xml, 'application/xml').querySelector('measure')!;
const order: string[] = [];
for (const c of [...m.children]) {
  const t = local(c);
  if (t === 'note') {
    order.push(c.querySelector('rest') ? 'rest' : 'note');
  } else if (t === 'attributes') {
    order.push('attrs:' + (c.querySelector('sign')?.textContent ?? '?'));
  }
}
console.log('order', order);
const div = m.querySelector('divisions')?.textContent?.trim();
console.log('divisions', div);
if (order.indexOf('attrs:G') < order.indexOf('note')) {
  throw new Error(`G before note: ${order.join('|')}`);
}
if (div !== '8') throw new Error(`expected divisions 8 after whole-note refine, got ${div}`);
if (!order.includes('rest')) throw new Error('expected invisible rest anchor');
console.log('ok pl whole trailing G preview anchor');
