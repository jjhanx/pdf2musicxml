/**
 * 마디 공간 가중치: max(beat-type, 음표·쉼표 수). 4/4→min4, 6/8→min8.
 * Run: npx tsx _smoke/test_measure_spacing_weights.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  collectMeasureSpacingWeightsFromXml,
  countMeasureNoteRestEvents,
  measureSpacingWeight,
  readMeasureBeatType,
} from '../shared/musicXmlMeasureSpacingWeights';

const dom = new JSDOM('<!DOCTYPE html><html></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
});

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
      <note><rest/><duration>2</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>eighth</type></note>
    </measure>
    <measure number="3">
      <attributes>
        <time><beats>6</beats><beat-type>8</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>eighth</type></note>
      <note><rest/><duration>1</duration><type>eighth</type></note>
    </measure>
  </part>
</score-partwise>`;

const doc = new DOMParser().parseFromString(xml, 'text/xml');
const measures = [...doc.querySelectorAll('measure')];
assert.equal(readMeasureBeatType(measures[0]!), 4);
assert.equal(countMeasureNoteRestEvents(measures[0]!), 2);
assert.equal(measureSpacingWeight(measures[0]!).weight, 4); // max(4,2)

assert.equal(countMeasureNoteRestEvents(measures[1]!), 8);
assert.equal(measureSpacingWeight(measures[1]!, 4).weight, 8); // max(4,8)

assert.equal(readMeasureBeatType(measures[2]!), 8);
assert.equal(measureSpacingWeight(measures[2]!, 4).weight, 8); // max(8,2)

const byMn = collectMeasureSpacingWeightsFromXml(xml);
assert.equal(byMn.get(1), 4);
assert.equal(byMn.get(2), 8);
assert.equal(byMn.get(3), 8);
console.log('OK measure spacing weights');
