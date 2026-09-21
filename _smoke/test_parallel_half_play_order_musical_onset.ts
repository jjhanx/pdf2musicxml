/**
 * Parallel LH: voice5 four quarters (no po) + voice6 two halves (po 1,2).
 * Half po=2 must layout at beat 3 (= v5 3rd quarter), not at v5 2nd quarter column.
 * Run: npx tsx _smoke/test_parallel_half_play_order_musical_onset.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  applyPlayOrderLayoutToMeasure,
  HITL_PLAY_ORDER_ATTR,
} from '../shared/musicXmlPlayOrder';
import { OSMD_LAYOUT_X_ATTR } from '../shared/musicXmlPreviewOnsetLayout';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;

/** d3dd67d4 m9 PL 축소 */
const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="9">
      <attributes><divisions>12</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>12</duration><type>quarter</type><voice>5</voice><staff>2</staff></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>12</duration><type>quarter</type><voice>5</voice><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>12</duration><type>quarter</type><voice>5</voice><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>12</duration><type>quarter</type><voice>5</voice><staff>2</staff></note>
      <backup><duration>48</duration></backup>
      <note ${HITL_PLAY_ORDER_ATTR}="1"><pitch><step>F</step><octave>2</octave></pitch><duration>24</duration><type>half</type><voice>6</voice><staff>2</staff></note>
      <note ${HITL_PLAY_ORDER_ATTR}="2"><pitch><step>E</step><octave>2</octave></pitch><duration>24</duration><type>half</type><voice>6</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

const doc = parseMusicXmlDocument(SAMPLE)!;
const measure = doc.querySelector('measure')!;
applyPlayOrderLayoutToMeasure(measure);

const v5xs: number[] = [];
const v6xs: number[] = [];
for (const note of [...measure.querySelectorAll('note')]) {
  if (note.querySelector(':scope > chord')) continue;
  const v = note.querySelector('voice')?.textContent;
  const raw = note.getAttribute(OSMD_LAYOUT_X_ATTR) ?? note.getAttribute('default-x') ?? '';
  const x = parseFloat(raw);
  if (v === '5') v5xs.push(x);
  if (v === '6') v6xs.push(x);
}
assert.equal(v5xs.length, 4, `v5 quarters, got ${v5xs.length}`);
assert.equal(v6xs.length, 2, `v6 halves, got ${v6xs.length}`);

const half1 = v6xs[0]!;
const half2 = v6xs[1]!;
const q1 = v5xs[0]!;
const q2 = v5xs[1]!;
const q3 = v5xs[2]!;

assert.ok(Math.abs(half1 - q1) < 0.5, `half1 with q1: ${half1} vs ${q1}`);
assert.ok(Math.abs(half2 - q3) < 0.5, `half2 must align with 3rd quarter (beat 3), got ${half2} vs q3=${q3} (q2=${q2})`);
assert.ok(Math.abs(half2 - q2) > 5, `half2 must NOT sit on 2nd quarter column: ${half2} vs ${q2}`);

const gapQ = q2 - q1;
const gapHalf = half2 - half1;
assert.ok(
  Math.abs(gapHalf - 2 * gapQ) / Math.max(gapQ, 1) < 0.08,
  `half gap should be ~2× quarter gap: half=${gapHalf} q=${gapQ}`,
);

console.log('ok parallel half play-order musical onset', { v5xs, v6xs });
