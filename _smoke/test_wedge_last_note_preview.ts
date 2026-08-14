/**
 * wedge stop on last PR note must stay after that note (not measure start / next measure).
 * Run: npx tsx _smoke/test_wedge_last_note_preview.ts
 */
import { JSDOM } from 'jsdom';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview.ts';
import { reanchorWedgeStopsForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;
g.Node = dom.window.Node;
g.Element = dom.window.Element;

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function measureXml(): string {
  return `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="5">
      <attributes><divisions>1</divisions><staves>2</staves></attributes>
      <direction placement="below"><direction-type><wedge type="crescendo" number="1" spread="0"/></direction-type><staff>1</staff></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <direction placement="below"><direction-type><wedge type="stop" number="1" spread="15"/></direction-type><staff>1</staff></direction>
      <backup><duration>3</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>3</duration><type>half</type><dot/><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
}

function headerStopXml(): string {
  return `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="5">
      <attributes><divisions>1</divisions></attributes>
      <direction placement="below"><direction-type><wedge type="crescendo" number="1"/></direction-type><staff>1</staff></direction>
      <direction placement="below"><direction-type><wedge type="stop" number="1"/></direction-type><staff>1</staff></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
}

function assertStopAfterLast(measure: Element, label: string): void {
  const children = [...measure.children];
  const notes = children.filter((c) => local(c) === 'note' && !c.querySelector('chord, *|chord'));
  const last = notes[notes.length - 1];
  let stop: Element | null = null;
  for (const c of children) {
    if (local(c) !== 'direction') continue;
    const w = [...c.querySelectorAll('wedge, *|wedge')].find((el) => el.getAttribute('type') === 'stop');
    if (w) stop = c;
  }
  if (!stop) {
    console.error(`FAIL ${label}: no wedge stop`);
    process.exit(1);
  }
  const stopIdx = children.indexOf(stop);
  const lastIdx = children.indexOf(last!);
  if (stopIdx <= lastIdx) {
    console.error(`FAIL ${label}: stop index ${stopIdx} not after last note ${lastIdx}`);
    process.exit(1);
  }
  if (local(children[0]!) === 'direction' && children[0] === stop) {
    console.error(`FAIL ${label}: stop still at measure start`);
    process.exit(1);
  }
}

const splitDoc = new DOMParser().parseFromString(measureXml(), 'application/xml');
const splitMeasure = splitDoc.querySelector('measure, *|measure')!;
for (const note of [...splitMeasure.children]) {
  if (local(note) !== 'note') continue;
  const st = note.querySelector('staff, *|staff')?.textContent?.trim();
  if (st === '2') note.remove();
}
pruneCrossStaffTimelineForOsmdPreview(splitMeasure, 1);
reanchorWedgeStopsForOsmdPreview(splitMeasure, 1);
assertStopAfterLast(splitMeasure, 'PR split last-note stop');

const headerDoc = new DOMParser().parseFromString(headerStopXml(), 'application/xml');
const headerMeasure = headerDoc.querySelector('measure, *|measure')!;
reanchorWedgeStopsForOsmdPreview(headerMeasure, 1);
assertStopAfterLast(headerMeasure, 'header-bubbled stop');

console.log('wedge last-note preview ok');
