/**
 * Preview slur normalize must keep different MusicXML numbers on one note.
 *
 * Pattern: a long slur (number=4) is still open when a short HITL slur
 * (number=1) starts and stops on consecutive notes, and the end note also
 * carries stop 4. Collapsing all stops to one number drops the HITL pair
 * and OSMD draws nothing for it.
 *
 * Same-number duplicates still collapse to the cleaner slur.
 *
 * Run: npx tsx _smoke/test_slur_preview_keep_distinct_numbers.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  normalizeSlursForOsmdPreview,
  repairTimelineForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';
import { parseMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

function scoreXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">${body}</part>
</score-partwise>`;
}

function note(
  step: string,
  octave: string,
  slurs: string,
): string {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><notations>${slurs}</notations></note>`;
}

function slurAttrs(el: Element): Array<{ type: string; number: string }> {
  return [...el.querySelectorAll(':scope > notations > slur')].map((s) => ({
    type: s.getAttribute('type') || '',
    number: s.getAttribute('number') || '1',
  }));
}

function notesOf(xml: string, measure: string): Element[] {
  const doc = parseMusicXmlDocument(xml);
  assert.ok(doc, 'parse');
  const m = [...doc.querySelectorAll('measure')].find((el) => el.getAttribute('number') === measure);
  assert.ok(m, `measure ${measure}`);
  return [...m.children].filter((el) => (el.localName || el.tagName).toLowerCase() === 'note');
}

const dualStopXml = scoreXml(`
  <measure number="1">
    ${note('E', '5', '<slur type="start" number="4" placement="above"/>')}
  </measure>
  <measure number="2">
    ${note('D', '5', '<slur type="start" number="1" placement="above" data-hitl-slur-distance="3"/>')}
    ${note(
      'C',
      '5',
      '<slur type="stop" number="4"/><slur type="stop" number="1" placement="above" data-hitl-slur-distance="3"/>',
    )}
  </measure>
`);

for (const label of ['normalizeSlursForOsmdPreview', 'repairTimelineForOsmdPreview'] as const) {
  const out =
    label === 'normalizeSlursForOsmdPreview'
      ? normalizeSlursForOsmdPreview(dualStopXml)
      : repairTimelineForOsmdPreview(dualStopXml);
  const m2 = notesOf(out, '2');
  assert.equal(m2.length, 2, `${label}: two notes`);
  const start1 = slurAttrs(m2[0]!);
  const stops = slurAttrs(m2[1]!);
  assert.deepEqual(start1, [{ type: 'start', number: '1' }], `${label}: HITL start 1 kept`);
  assert.equal(stops.length, 2, `${label}: both stops kept`);
  assert.ok(
    stops.some((s) => s.type === 'stop' && s.number === '4'),
    `${label}: long stop 4 kept`,
  );
  assert.ok(
    stops.some((s) => s.type === 'stop' && s.number === '1'),
    `${label}: HITL stop 1 kept`,
  );
}

const dualStartXml = scoreXml(`
  <measure number="1">
    ${note(
      'G',
      '4',
      '<slur type="start" number="1" placement="above"/><slur type="start" number="2" placement="below"/>',
    )}
    ${note('A', '4', '<slur type="stop" number="1"/>')}
    ${note('B', '4', '<slur type="stop" number="2"/>')}
  </measure>
`);
const dualStartOut = normalizeSlursForOsmdPreview(dualStartXml);
const dualStartNotes = notesOf(dualStartOut, '1');
assert.deepEqual(
  slurAttrs(dualStartNotes[0]!),
  [
    { type: 'start', number: '1' },
    { type: 'start', number: '2' },
  ],
  'two different-number starts on one note stay',
);

const sameNumberDupXml = scoreXml(`
  <measure number="1">
    ${note(
      'C',
      '4',
      '<slur type="start" number="1" bezier-x="2" default-y="12"/><slur type="start" number="1"/>',
    )}
    ${note(
      'D',
      '4',
      '<slur type="stop" number="1" bezier-y="-4"/><slur type="stop" number="1"/>',
    )}
  </measure>
`);
const sameOut = normalizeSlursForOsmdPreview(sameNumberDupXml);
const sameNotes = notesOf(sameOut, '1');
assert.deepEqual(slurAttrs(sameNotes[0]!), [{ type: 'start', number: '1' }], 'same-number starts collapse');
assert.deepEqual(slurAttrs(sameNotes[1]!), [{ type: 'stop', number: '1' }], 'same-number stops collapse');
const keptStart = sameNotes[0]!.querySelector(':scope > notations > slur');
const keptStop = sameNotes[1]!.querySelector(':scope > notations > slur');
assert.equal(keptStart?.hasAttribute('bezier-x'), false, 'prefer start without layout attrs');
assert.equal(keptStop?.hasAttribute('bezier-y'), false, 'prefer stop without layout attrs');

console.log('slur preview keep distinct numbers ok');
