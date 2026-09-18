/**
 * HITL faithful: overfull notes stay editable (not cut). Non-faithful still clamps for display.
 * Run: npx tsx _smoke/test_overfull_no_spill_next_measure.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  capBackupDurationsForOsmdPreview,
  repairTimelineForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';
import { collectMeasureTimingIssuesFromXml } from '../shared/musicXmlMeasureTiming.ts';
import { previewLayoutLengthUnits } from '../shared/musicXmlPreviewOnsetLayout.ts';

const dom = new JSDOM('<!DOCTYPE html><html></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  document: dom.window.document,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

const overfull = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="4">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>B</step><octave>2</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

function voiceDurationSum(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const m = doc.querySelector('measure')!;
  let sum = 0;
  for (const n of [...m.querySelectorAll('note')]) {
    if (n.querySelector('chord')) continue;
    if (n.querySelector('grace')) continue;
    sum += parseInt(n.querySelector('duration')?.textContent || '0', 10) || 0;
  }
  return sum;
}

function noteCount(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('measure note')].filter((n) => !n.querySelector('chord')).length;
}

// 표시 전용(non-faithful): capacity로 절단
const capped = capBackupDurationsForOsmdPreview(overfull);
assert.equal(voiceDurationSum(capped), 16, `display clamp sum 16, got ${voiceDurationSum(capped)}`);
assert.ok(noteCount(capped) <= 4, `display clamp removes overflow, got ${noteCount(capped)}`);

// HITL faithful: 음표 보존 + 타이밍 이슈 경고용
const faithfulCap = capBackupDurationsForOsmdPreview(overfull, { preserveOverfullNotes: true });
assert.equal(noteCount(faithfulCap), 6, `faithful keeps all notes, got ${noteCount(faithfulCap)}`);
assert.equal(voiceDurationSum(faithfulCap), 24, `faithful keeps overfull sum, got ${voiceDurationSum(faithfulCap)}`);

const faithful = repairTimelineForOsmdPreview(overfull, { faithfulEditorLayout: true });
assert.equal(noteCount(faithful), 6, `repairTimeline faithful keeps notes, got ${noteCount(faithful)}`);
const issues = collectMeasureTimingIssuesFromXml(faithful);
assert.ok(
  issues.some((i) => i.kind === 'overfull' && i.measureNumber === 4),
  `expected overfull warning issue, got ${JSON.stringify(issues)}`,
);

const doc = new DOMParser().parseFromString(capped, 'text/xml');
const layoutLen = previewLayoutLengthUnits(doc.querySelector('measure')!);
assert.equal(layoutLen, 16, `layout length must be time capacity, got ${layoutLen}`);

console.log('test_overfull_no_spill_next_measure: OK');
