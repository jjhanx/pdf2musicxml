/** PDF 페이지 구간·HITL affected measure — 증분 미리보기 회귀 */
import { JSDOM } from 'jsdom';
import {
  buildPdfPageMeasureIndex,
  buildPdfPageSystemRows,
  filterMusicXmlToMeasureRange,
  inferMeasureRangeForPdfPage,
  inferPdfPageForMxlMeasure,
  measureRangeFromPageIndex,
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
// 단일 마디 미리보기 — OSMD 로컬/팬텀 번호 무시
if (normalizeToGlobalMeasureMxl(1, { start: 41, end: 41 }) !== 41) {
  throw new Error('single-measure preview: local 1 must stay global 41');
}
if (normalizeToGlobalMeasureMxl(99, { start: 41, end: 41 }) !== 41) {
  throw new Error('single-measure preview: out-of-range must clamp to 41');
}
if (normalizeToGlobalMeasureMxl(0, { start: 41, end: 48 }) !== 41) {
  throw new Error('page range: n<1 clamps to start');
}
if (normalizeToGlobalMeasureMxl(100, { start: 41, end: 48 }) !== 48) {
  throw new Error('page range: far local clamps to end');
}

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="32"><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="33"><print new-page="yes"/><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="34"><print new-system="yes"/><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="40"><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="41"><print new-page="yes"/><note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
  </part>
</score-partwise>`;

const idx = buildPdfPageMeasureIndex(sample);
if (idx.pageStarts[0] !== 1 || idx.pageStarts[1] !== 33 || idx.pageStarts[2] !== 41) {
  throw new Error(`pageStarts expected [1,33,41] got ${idx.pageStarts.join(',')}`);
}
if (inferPdfPageForMxlMeasure(idx, 1) !== 1 || inferPdfPageForMxlMeasure(idx, 33) !== 2) {
  throw new Error('inferPdfPageForMxlMeasure failed');
}
if (inferPdfPageForMxlMeasure(idx, 40) !== 2 || inferPdfPageForMxlMeasure(idx, 41) !== 3) {
  throw new Error('inferPdfPageForMxlMeasure boundary failed');
}

const r2 = inferMeasureRangeForPdfPage(sample, 2);
if (r2.start !== 33 || r2.end !== 40) {
  throw new Error(`page2 range expected 33-40 got ${r2.start}-${r2.end}`);
}
const r2idx = measureRangeFromPageIndex(idx, 2);
if (r2idx.start !== 33 || r2idx.end !== 40) {
  throw new Error(`index page2 range expected 33-40 got ${r2idx.start}-${r2idx.end}`);
}

const rows2 = buildPdfPageSystemRows(sample, 2);
if (rows2.length !== 2 || rows2[0]?.[0] !== 33 || rows2[1]?.[0] !== 34) {
  throw new Error(`page2 system rows expected [[33…],[34…]] got ${JSON.stringify(rows2)}`);
}
if (!rows2[1]?.includes(40)) {
  throw new Error('page2 second system should include m.40');
}
const rows3 = buildPdfPageSystemRows(sample, 3);
if (rows3.length !== 1 || rows3[0]?.join(',') !== '41') {
  throw new Error(`page3 system rows expected [[41]] got ${JSON.stringify(rows3)}`);
}

const filtered = filterMusicXmlToMeasureRange(sample, 33, 40);
const nums = [...filtered.matchAll(/<measure number="(\d+)"/g)].map((m) => Number(m[1]));
if (!nums.every((n) => n >= 33 && n <= 40) || nums.length !== 3) {
  throw new Error(`filtered measures wrong: ${nums.join(',')}`);
}

const one = filterMusicXmlToMeasureRange(sample, 33, 33);
const oneNums = [...one.matchAll(/<measure number="(\d+)"/g)].map((m) => Number(m[1]));
if (oneNums.length !== 1 || oneNums[0] !== 33) {
  throw new Error(`single-measure filter expected [33] got ${oneNums.join(',')}`);
}
// 앞 마디 G clef가 구간 첫 마디에 주입되어야 마디 단위 OSMD에서 음자리표가 유지됨
if (!/<clef[\s>]/.test(one) || !/<sign>\s*G\s*<\/sign>/.test(one)) {
  throw new Error('single-measure filter should inject carried clef from earlier measures');
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

console.log('OK page measure range + measure nav index + affected measures');
