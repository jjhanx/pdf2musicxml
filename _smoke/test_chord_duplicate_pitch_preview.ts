/**
 * Duplicate same-pitch chord members are stripped in OSMD preview.
 * Run: npx tsx _smoke/test_chord_duplicate_pitch_preview.ts
 */
import { JSDOM } from 'jsdom';
import { dedupeIdenticalChordPitchesForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;
g.Node = dom.window.Node;
g.Element = dom.window.Element;

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="7">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>half</type></note>
      <note><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>half</type></note>
      <note><chord/><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;

const out = dedupeIdenticalChordPitchesForOsmdPreview(xml);
const a4 = [...out.matchAll(/<step>A<\/step>/g)].length;
const c4 = [...out.matchAll(/<step>C<\/step>/g)].length;
if (c4 !== 1 || a4 !== 1) {
  console.error('FAIL: expected one C and one A after chord pitch dedupe', { c4, a4, out });
  process.exit(1);
}
console.log('chord duplicate pitch preview ok');
