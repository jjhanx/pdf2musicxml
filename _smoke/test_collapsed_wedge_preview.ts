/**
 * Collapsed wedge repairs in OSMD preview normalize.
 * Run: npx tsx _smoke/test_collapsed_wedge_preview.ts
 */
import { JSDOM } from 'jsdom';
import { normalizeDynamicsAndWedgesForOsmdPreview } from '../shared/musicXmlDirectionPlacement';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

function parseMeasure(xml: string): Element {
  const doc = new DOMParser().parseFromString(
    `<?xml version="1.0"?><score-partwise><part id="P1">${xml}</part></score-partwise>`,
    'text/xml',
  );
  return doc.getElementsByTagName('measure')[0]!;
}

function dumpWedges(m: Element): string[] {
  const out: string[] = [];
  [...m.children].forEach((c, i) => {
    const tag = c.localName || c.tagName;
    if (tag === 'backup') out.push(`${i}:backup`);
    if (tag !== 'direction') return;
    const w = c.querySelector('wedge');
    if (w) out.push(`${i}:wedge-${w.getAttribute('type')}`);
  });
  return out;
}

// empty adjacent → after normalize stop past first note (and OSMD advance past next)
{
  const raw = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>B</part-name></score-part></part-list>
  <part id="P1"><measure number="69">
    <attributes><divisions>8</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
    <clef><sign>F</sign><line>4</line></clef></attributes>
    <direction><direction-type><wedge type="crescendo" spread="0"/></direction-type><staff>1</staff></direction>
    <direction><direction-type><wedge type="stop" spread="15"/></direction-type><staff>1</staff></direction>
    <note><pitch><step>A</step><octave>2</octave></pitch><duration>8</duration><type>half</type></note>
    <note><chord/><pitch><step>E</step><octave>3</octave></pitch><duration>8</duration><type>half</type></note>
    <note><rest/><duration>8</duration><type>half</type></note>
  </measure></part>
</score-partwise>`;
  const out = normalizeDynamicsAndWedgesForOsmdPreview(raw);
  const m = parseMeasure(out.replace(/^[\s\S]*?<measure/, '<measure').replace(/<\/measure>[\s\S]*$/, '</measure>'));
  // re-parse properly
  const doc = new DOMParser().parseFromString(out, 'text/xml');
  const meas = doc.getElementsByTagName('measure')[0]!;
  const kids = [...meas.children];
  const stopI = kids.findIndex(
    (c) => c.localName === 'direction' && c.querySelector('wedge')?.getAttribute('type') === 'stop',
  );
  const firstNoteI = kids.findIndex((c) => c.localName === 'note');
  if (!(stopI > firstNoteI)) {
    throw new Error(`adjacent empty: stop should follow notes, got ${dumpWedges(meas)}`);
  }
}

// backup-misplaced stop
{
  const raw = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>PR</part-name></score-part></part-list>
  <part id="P1"><measure number="5">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type><staff>1</staff></note>
    <direction><direction-type><wedge type="crescendo" spread="0"/></direction-type><staff>1</staff></direction>
    <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>whole</type><staff>1</staff></note>
    <backup><duration>9</duration></backup>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
    <direction><direction-type><wedge type="stop" spread="15"/></direction-type><staff>1</staff></direction>
    <note><chord/><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
  </measure></part>
</score-partwise>`;
  const out = normalizeDynamicsAndWedgesForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(out, 'text/xml');
  const meas = doc.getElementsByTagName('measure')[0]!;
  const kids = [...meas.children];
  const stopI = kids.findIndex(
    (c) => c.localName === 'direction' && c.querySelector('wedge')?.getAttribute('type') === 'stop',
  );
  const backupI = kids.findIndex((c) => c.localName === 'backup');
  if (!(stopI >= 0 && backupI >= 0 && stopI < backupI)) {
    throw new Error(`backup stop: expected stop before backup, got ${dumpWedges(meas)}`);
  }
}

console.log('ok collapsed wedge preview repairs');
