/**
 * ensureSecondaryBeamLevelsForOsmdPreview adds beam 2 for 16ths in an eighth run.
 * Run: npx tsx _smoke/test_secondary_beam_preview.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  ensureSecondaryBeamLevelsForOsmdPreview,
  repairTimelineForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';

const dom = new JSDOM('<!DOCTYPE html><html></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>2</duration><type>eighth</type>
        <voice>5</voice><staff>1</staff><beam number="1">begin</beam></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>1</duration><type>16th</type>
        <voice>5</voice><staff>1</staff><beam number="1">continue</beam></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>16th</type>
        <voice>5</voice><staff>1</staff><beam number="1">end</beam></note>
    </measure>
  </part>
</score-partwise>`;

const out = ensureSecondaryBeamLevelsForOsmdPreview(xml);
const doc = new DOMParser().parseFromString(out, 'text/xml');
const notes = [...doc.querySelectorAll('note')];
const b1 = [...notes[1]!.querySelectorAll('beam')].map((b) => `${b.getAttribute('number')}:${b.textContent}`);
const b2 = [...notes[2]!.querySelectorAll('beam')].map((b) => `${b.getAttribute('number')}:${b.textContent}`);
assert.ok(b1.includes('2:begin'), `16th should get beam2 begin, got ${b1}`);
assert.ok(b2.includes('2:end'), `16th should get beam2 end, got ${b2}`);

const viaRepair = repairTimelineForOsmdPreview(xml, { faithfulEditorLayout: true });
const doc2 = new DOMParser().parseFromString(viaRepair, 'text/xml');
const n1 = [...doc2.querySelectorAll('note')][1]!;
assert.ok(
  [...n1.querySelectorAll('beam')].some((b) => b.getAttribute('number') === '2'),
  'repairTimeline should ensure secondary beams',
);

console.log('test_secondary_beam_preview: OK');
