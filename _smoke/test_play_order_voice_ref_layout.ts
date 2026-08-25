/**
 * `5-6` 연주순번 참조 → voice5 순번6과 같은 default-x.
 * Run: npx tsx _smoke/test_play_order_voice_ref_layout.ts
 */
import { JSDOM } from 'jsdom';
import {
  HITL_PLAY_ORDER_ATTR,
  applyPlayOrderLayoutToMeasure,
  parsePlayOrderSpec,
  readPlayOrderRef,
} from '../shared/musicXmlPlayOrder';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;

const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="21">
      <attributes><divisions>8</divisions></attributes>
      <note data-hitl-play-order="1"><pitch><step>F</step><octave>3</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note data-hitl-play-order="2"><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note data-hitl-play-order="3"><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note data-hitl-play-order="4"><pitch><step>D</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note data-hitl-play-order="5"><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note data-hitl-play-order="6"><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <backup><duration>48</duration></backup>
      <note data-hitl-play-order="5-6"><pitch><step>G</step><octave>3</octave></pitch><duration>16</duration><type>quarter</type><voice>6</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

function main() {
  const spec = parsePlayOrderSpec('5-6');
  if (!spec || spec.kind !== 'ref' || spec.voice !== 5 || spec.order !== 6) {
    throw new Error(`parse 5-6 failed: ${JSON.stringify(spec)}`);
  }

  const doc = parseMusicXmlDocument(SAMPLE)!;
  const measure = doc.querySelector('measure')!;
  applyPlayOrderLayoutToMeasure(measure);

  const notes = [...measure.querySelectorAll('note')];
  const g4 = notes.find((n) => {
    if (n.querySelector(':scope > chord')) return false;
    return (
      n.querySelector('step')?.textContent === 'G' && n.querySelector('octave')?.textContent === '4'
    );
  })!;
  const g3 = notes.find((n) => {
    if (n.querySelector(':scope > chord')) return false;
    return (
      n.querySelector('step')?.textContent === 'G' && n.querySelector('octave')?.textContent === '3'
    );
  })!;

  if (g4.getAttribute(HITL_PLAY_ORDER_ATTR) !== '6') {
    throw new Error(`g4 attr ${g4.getAttribute(HITL_PLAY_ORDER_ATTR)}`);
  }
  if (g3.getAttribute(HITL_PLAY_ORDER_ATTR) !== '5-6') {
    throw new Error(`g3 attr must stay 5-6, got ${g3.getAttribute(HITL_PLAY_ORDER_ATTR)}`);
  }
  const ref = readPlayOrderRef(g3);
  if (!ref || ref.voice !== 5 || ref.order !== 6) throw new Error('readPlayOrderRef');

  const x6 = g4.getAttribute('default-x');
  const xRef = g3.getAttribute('default-x');
  if (!x6 || !xRef || Math.abs(parseFloat(x6) - parseFloat(xRef)) > 0.01) {
    throw new Error(`default-x mismatch po6=${x6} ref=${xRef}`);
  }
  const x1 = notes
    .find((n) => n.getAttribute(HITL_PLAY_ORDER_ATTR) === '1')!
    .getAttribute('default-x')!;
  if (!(parseFloat(xRef) > parseFloat(x1) + 50)) {
    throw new Error(`ref should be right of po1: ref=${xRef} po1=${x1}`);
  }

  console.log('play_order_voice_ref_layout ok', { x6, xRef });
}

main();
