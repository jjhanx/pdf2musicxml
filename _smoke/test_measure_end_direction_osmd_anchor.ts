/**
 * HITL 마디 끝 direction — OSMD preview에 숨은 쉼 앵커가 붙어
 * 마지막 음 onset이 아니라 마디 뒤에 타임스탬프가 생기도록.
 *
 * Run: npx tsx _smoke/test_measure_end_direction_osmd_anchor.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  HITL_MEASURE_ANCHOR_ATTR,
  HITL_MEASURE_END_ANCHOR_REST_ATTR,
  anchorMeasureEndDirectionsForOsmdPreview,
} from '../shared/musicXmlMeasureEndDirectionOsmdAnchor';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  document: dom.window.document,
  Element: dom.window.Element,
  Node: dom.window.Node,
});

const RAW = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note default-x="80">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
        <voice>1</voice>
      </note>
      <direction placement="below" ${HITL_MEASURE_ANCHOR_ATTR}="end" default-x="136">
        <direction-type><dynamics><mf/></dynamics></direction-type>
        <staff>1</staff>
      </direction>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>`;

const out = anchorMeasureEndDirectionsForOsmdPreview(RAW);
assert.ok(out.includes(HITL_MEASURE_END_ANCHOR_REST_ATTR), 'must insert anchor rest');
assert.ok(out.includes('print-object="no"'), 'anchor rest must be invisible');
assert.ok(out.includes('<mf'), 'dynamics preserved');
assert.ok(out.includes(`${HITL_MEASURE_ANCHOR_ATTR}="end"`), 'measure-end attr preserved');

const dirIdx = out.indexOf('<direction');
const restIdx = out.indexOf(HITL_MEASURE_END_ANCHOR_REST_ATTR);
const barIdx = out.indexOf('<barline');
assert.ok(dirIdx > 0 && restIdx > dirIdx && barIdx > restIdx, 'order: direction → rest → barline');

assert.match(out, /<duration>31<\/duration>/, 'peeled duration from whole after refine');
assert.match(out, /<divisions>8<\/divisions>/, 'divisions refined for whole fill');

const out2 = anchorMeasureEndDirectionsForOsmdPreview(out);
assert.equal(
  (out.match(new RegExp(HITL_MEASURE_END_ANCHOR_REST_ATTR, 'g')) || []).length,
  (out2.match(new RegExp(HITL_MEASURE_END_ANCHOR_REST_ATTR, 'g')) || []).length,
);

console.log('OK measure-end direction OSMD anchor');
