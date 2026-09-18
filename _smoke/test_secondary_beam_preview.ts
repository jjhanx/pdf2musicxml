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

// 16th + dotted eighth: lone 16th needs forward hook (not begin/end onto the dotted 8th)
const mixed = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="4">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>16th</type>
        <voice>5</voice><staff>1</staff><beam number="1">begin</beam></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>3</duration><type>eighth</type><dot/>
        <voice>5</voice><staff>1</staff><beam number="1">end</beam></note>
    </measure>
  </part>
</score-partwise>`;
const mixedOut = ensureSecondaryBeamLevelsForOsmdPreview(mixed);
const mixedDoc = new DOMParser().parseFromString(mixedOut, 'text/xml');
const mn = [...mixedDoc.querySelectorAll('note')];
const mb0 = [...mn[0]!.querySelectorAll('beam')].map((b) => `${b.getAttribute('number')}:${b.textContent}`);
const mb1 = [...mn[1]!.querySelectorAll('beam')].map((b) => `${b.getAttribute('number')}:${b.textContent}`);
assert.ok(mb0.includes('2:forward hook'), `16th should get forward hook, got ${mb0}`);
assert.equal(mb1.filter((x) => x.startsWith('2:')).length, 0, `dotted 8th must not get beam2, got ${mb1}`);
assert.ok(mn[1]!.querySelector('dot'), 'dotted eighth must keep its dot');
assert.equal(mn[1]!.querySelector('type')?.textContent, 'eighth');

console.log('test_secondary_beam_preview: OK');
