/**
 * Partial voice2 + explicit po — voice1 timeline default column과 정렬.
 * Run: npx tsx _smoke/test_partial_voice_play_order_column.ts
 */
import { JSDOM } from 'jsdom';
import {
  applyPlayOrderLayoutToMeasure,
  HITL_PLAY_ORDER_ATTR,
} from '../shared/musicXmlPlayOrder';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;

/** d60eab53 m33 PL 축소 — voice1 전체 + voice2는 po1·po2만 */
const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="33">
      <attributes><divisions>12</divisions></attributes>
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>6</duration><type>eighth</type><voice>1</voice><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>6</duration><type>eighth</type><voice>1</voice><staff>2</staff></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>12</duration><type>quarter</type><voice>1</voice><staff>2</staff></note>
      <backup><duration>87</duration></backup>
      <forward><duration>18</duration></forward>
      <note ${HITL_PLAY_ORDER_ATTR}="1"><pitch><step>A</step><octave>2</octave></pitch><duration>48</duration><type>half</type><voice>2</voice><staff>2</staff></note>
      <note ${HITL_PLAY_ORDER_ATTR}="2"><pitch><step>A</step><octave>2</octave></pitch><duration>24</duration><type>quarter</type><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

function xOf(measure: Element, voice: string, po: number | null, step: string): number {
  for (const note of [...measure.querySelectorAll('note')]) {
    if (note.querySelector(':scope > chord')) continue;
    if (note.querySelector('voice')?.textContent !== voice) continue;
    if (po != null) {
      const attr = note.getAttribute(HITL_PLAY_ORDER_ATTR);
      if (attr !== String(po)) continue;
    }
    if (note.querySelector('step')?.textContent !== step) continue;
    const x = note.getAttribute('default-x');
    if (!x) throw new Error(`missing default-x v${voice} po=${po} ${step}`);
    return parseFloat(x);
  }
  throw new Error(`note not found v${voice} po=${po} ${step}`);
}

const doc = parseMusicXmlDocument(SAMPLE)!;
const measure = doc.querySelector('measure')!;
applyPlayOrderLayoutToMeasure(measure);

const v1po1 = xOf(measure, '1', null, 'A');
const v2po1 = xOf(measure, '2', 1, 'A');
const v1po2 = xOf(measure, '1', null, 'E');
const v2po2 = xOf(measure, '2', 2, 'A');

if (Math.abs(v1po1 - v2po1) > 0.01) {
  throw new Error(`po1 column mismatch: v1=${v1po1} v2=${v2po1}`);
}
if (Math.abs(v1po2 - v2po2) > 0.01) {
  throw new Error(`po2 column mismatch: v1=${v1po2} v2=${v2po2}`);
}
if (!(v2po1 < v2po2 - 1)) {
  throw new Error(`po2 should be right of po1: ${v2po1} vs ${v2po2}`);
}

console.log('partial_voice_play_order_column ok');
