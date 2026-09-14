/** OSMD preview: data-hitl-stem 잠금 음은 monophonic stem 정규화에서 제외 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizeMultivoiceStemsForOsmdPreview } from '../shared/musicXmlStem.ts';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="33">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration>
        <voice>1</voice><type>16th</type><stem data-hitl-stem="down">down</stem><staff>1</staff>
        <beam number="1">begin</beam></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration>
        <voice>1</voice><type>16th</type><stem data-hitl-stem="down">down</stem><staff>1</staff>
        <beam number="1">continue</beam></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration>
        <voice>1</voice><type>16th</type><stem data-hitl-stem="down">down</stem><staff>1</staff>
        <beam number="1">continue</beam></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration>
        <voice>1</voice><type>16th</type><stem data-hitl-stem="down">down</stem><staff>1</staff>
        <beam number="1">end</beam></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration>
        <voice>1</voice><type>quarter</type><stem>up</stem><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

const out = normalizeMultivoiceStemsForOsmdPreview(xml);
const stems = [...out.matchAll(/<stem([^>]*)>([^<]*)<\/stem>/g)].map((m) => ({
  attrs: m[1] ?? '',
  text: m[2]?.trim() ?? '',
}));
assert.equal(stems.length, 5);
assert.ok(stems.slice(0, 4).every((s) => s.text === 'down' && s.attrs.includes('data-hitl-stem="down"')));
assert.equal(stems[4]?.text, 'up');
console.log('ok');
