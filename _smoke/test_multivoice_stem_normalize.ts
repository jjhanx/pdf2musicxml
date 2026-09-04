/**
 * OSMD preview path: overlapping voices get opposite stems in MusicXML.
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizeMultivoiceStemsForOsmdPreview } from '../shared/musicXmlStem.ts';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration>
        <voice>1</voice><type>quarter</type><stem>up</stem><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration>
        <voice>2</voice><type>16th</type><stem>up</stem><staff>1</staff>
        <beam number="1">begin</beam></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration>
        <voice>2</voice><type>eighth</type><stem>up</stem><staff>1</staff>
        <beam number="1">continue</beam></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration>
        <voice>2</voice><type>16th</type><stem>up</stem><staff>1</staff>
        <beam number="1">end</beam></note>
    </measure>
  </part>
</score-partwise>`;

const out = normalizeMultivoiceStemsForOsmdPreview(xml);
assert.ok(out.includes('<stem>down</stem>'), 'secondary voice should be down');
const stems = [...out.matchAll(/<voice>(\d+)<\/voice>[\s\S]*?<stem>([^<]*)<\/stem>/g)].map((m) => ({
  voice: m[1],
  stem: m[2],
}));
assert.equal(stems[0]?.voice, '1');
assert.equal(stems[0]?.stem, 'up');
for (const s of stems.slice(1)) {
  assert.equal(s.voice, '2');
  assert.equal(s.stem, 'down');
}
console.log('ok');
