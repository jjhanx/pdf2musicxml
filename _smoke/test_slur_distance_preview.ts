/**
 * 이음줄 거리 HITL 미리보기 XML — slur default-y/data-hitl-slur-distance.
 * Run: npx tsx _smoke/test_slur_distance_preview.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applySlurDistanceFixesToPreviewXml, HITL_SLUR_DISTANCE_ATTR } from '../shared/musicXmlSlurDistance';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part id="P1__PL">
    <measure number="53">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><notations><slur type="start" number="1" placement="below"/></notations></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><notations><slur type="stop" number="1" placement="below"/></notations></note>
    </measure>
  </part>
</score-partwise>`;

const out = applySlurDistanceFixesToPreviewXml(xml, [
  {
    kind: 'setSlurPlacement',
    partId: 'P1__PL',
    measureMxl: '53',
    noteIndex: 0,
    slurEnd: 'start',
    placement: 'below',
    distance: '3',
  },
]);

const doc = new DOMParser().parseFromString(out, 'application/xml');
const slur = doc.querySelector('slur[type="start"]');
assert.ok(slur);
assert.equal(slur?.getAttribute('placement'), 'below');
assert.equal(slur?.getAttribute('default-y'), '-30');
assert.equal(slur?.getAttribute(HITL_SLUR_DISTANCE_ATTR), '3');

const reset = applySlurDistanceFixesToPreviewXml(out, [
  {
    kind: 'setSlurPlacement',
    partId: 'P1__PL',
    measureMxl: '53',
    noteIndex: 0,
    slurEnd: 'start',
    placement: 'above',
    distance: null,
  },
]);
const resetDoc = new DOMParser().parseFromString(reset, 'application/xml');
const resetSlur = resetDoc.querySelector('slur[type="start"]');
assert.equal(resetSlur?.getAttribute('placement'), 'above');
assert.equal(resetSlur?.hasAttribute(HITL_SLUR_DISTANCE_ATTR), false);
assert.equal(resetSlur?.getAttribute('default-y'), '10');

console.log('slur distance preview ok');
