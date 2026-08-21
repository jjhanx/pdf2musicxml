/**
 * PL wedge stop after E2 (before backup) must stay — not jump after E4.
 * Run: npx tsx _smoke/test_b02f_pl_wedge_reanchor.ts
 */
import { JSDOM } from 'jsdom';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview.ts';
import {
  reanchorWedgeStopsForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="9">
      <attributes><divisions>24</divisions><staves>2</staves></attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>96</duration><type>whole</type><staff>1</staff><voice>1</voice></note>
      <note><rest/><duration>12</duration><type>eighth</type><staff>2</staff><voice>1</voice></note>
      <direction placement="above"><direction-type><wedge type="diminuendo" number="1" spread="15"/></direction-type><staff>2</staff></direction>
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>72</duration><type>half</type><staff>2</staff><voice>2</voice></note>
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>12</duration><type>eighth</type><staff>2</staff><voice>2</voice></note>
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>6</duration><type>16th</type><staff>2</staff><voice>2</voice></note>
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>6</duration><type>16th</type><staff>2</staff><voice>2</voice></note>
      <direction placement="above"><direction-type><wedge type="stop" number="1" spread="0"/></direction-type><staff>2</staff></direction>
      <backup><duration>96</duration></backup>
      <forward><duration>9</duration></forward>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>12</duration><type>eighth</type><staff>2</staff><voice>1</voice></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>36</duration><type>quarter</type><staff>2</staff><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

const doc = new DOMParser().parseFromString(xml, 'application/xml');
const measure = doc.querySelector('measure')!;
for (const note of [...measure.children]) {
  if (local(note) !== 'note') continue;
  const st = note.querySelector('staff')?.textContent?.trim();
  if (st === '1') note.remove();
}
pruneCrossStaffTimelineForOsmdPreview(measure, 2);
normalizeMultiVoiceLayersForOsmdPreview(measure);
reanchorWedgeStopsForOsmdPreview(measure, 2);

const children = [...measure.children];
const labels = children.map((c) => {
  if (local(c) === 'direction') {
    const w = c.querySelector('wedge');
    return `wedge(${w?.getAttribute('type')})`;
  }
  if (local(c) === 'note') {
    if (c.querySelector('rest')) return 'REST';
    return (c.querySelector('step')?.textContent || '') + (c.querySelector('octave')?.textContent || '');
  }
  if (local(c) === 'backup') return 'backup';
  if (local(c) === 'forward') return 'forward';
  return local(c);
});
console.log('timeline', labels.join(' → '));

const stopIdx = labels.indexOf('wedge(stop)');
const dimIdx = labels.indexOf('wedge(diminuendo)');
const e2Idx = labels.indexOf('E2');
const a2Idx = labels.indexOf('A2');
if (dimIdx < 0 || stopIdx < 0) throw new Error('missing wedge');
if (!(dimIdx < stopIdx)) throw new Error(`start after stop: ${labels.join(' → ')}`);
if (!(a2Idx >= 0 && dimIdx < a2Idx && stopIdx > e2Idx)) {
  throw new Error(`wedge not around A2→E2: ${labels.join(' → ')}`);
}
// start must not sit before the upper melody if bass is after backup
const e3Idx = labels.indexOf('E3');
if (e3Idx >= 0 && dimIdx < e3Idx && a2Idx > e3Idx) {
  throw new Error(`diminuendo glued to melody instead of bass: ${labels.join(' → ')}`);
}
console.log('b02f PL wedge reanchor ok');
