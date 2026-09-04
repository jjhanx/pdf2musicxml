/** PDF 페이지 구간·HITL affected measure — 증분 미리보기 회귀 */
import { JSDOM } from 'jsdom';
import {
  filterMusicXmlToMeasureRange,
  inferMeasureRangeForPdfPage,
  normalizeToGlobalMeasureMxl,
} from '../shared/musicXmlMeasureRange';
import { affectedMeasuresFromFixes, expandMeasureMxlSpec } from '../shared/omrHitlAffectedMeasures';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { contentType: 'text/html' });
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const r33 = { start: 30, end: 40 };
if (normalizeToGlobalMeasureMxl(4, r33) !== 33) {
  throw new Error('local m.4 on page 30-40 should map to global 33');
}
if (normalizeToGlobalMeasureMxl(33, r33) !== 33) {
  throw new Error('global 33 should stay 33');
}
if (normalizeToGlobalMeasureMxl(4, { start: 1, end: 10 }) !== 4) {
  throw new Error('full-score start=1: local 4 stays 4');
}

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="32"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="33"><print new-page="yes"/><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="40"><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="41"><print new-page="yes"/><note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
  </part>
</score-partwise>`;

const r2 = inferMeasureRangeForPdfPage(sample, 2);
if (r2.start !== 33 || r2.end !== 40) {
  throw new Error(`page2 range expected 33-40 got ${r2.start}-${r2.end}`);
}

const filtered = filterMusicXmlToMeasureRange(sample, 33, 40);
const nums = [...filtered.matchAll(/<measure number="(\d+)"/g)].map((m) => Number(m[1]));
if (!nums.every((n) => n >= 33 && n <= 40) || nums.length !== 2) {
  throw new Error(`filtered measures wrong: ${nums.join(',')}`);
}

const one = filterMusicXmlToMeasureRange(sample, 33, 33);
const oneNums = [...one.matchAll(/<measure number="(\d+)"/g)].map((m) => Number(m[1]));
if (oneNums.length !== 1 || oneNums[0] !== 33) {
  throw new Error(`single-measure filter expected [33] got ${oneNums.join(',')}`);
}

const affected = affectedMeasuresFromFixes([
  {
    kind: 'copyMeasureContent',
    fromPartId: 'P2',
    toPartIds: ['P3', 'P4'],
    measureMxl: '33-34',
  },
]);
const keys = new Set(affected.map((a) => `${a.partId}:${a.measureMxl}`));
for (const m of expandMeasureMxlSpec('33-34')) {
  if (!keys.has(`P3:${m}`)) throw new Error(`missing P3 m${m}`);
}

console.log('OK page measure range + affected measures');
