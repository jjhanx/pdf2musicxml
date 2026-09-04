/** PDF 페이지 구간·HITL affected measure — 증분 미리보기 회귀 */
import { JSDOM } from 'jsdom';
import {
  buildPdfPageMeasureIndex,
  buildPdfPageSystemRows,
  filterMusicXmlToMeasureRange,
  inferMeasureRangeForPdfPage,
  inferPdfPageForMxlMeasure,
  lightOsmdPreviewMeasureRange,
  measureRangeFromPageIndex,
  normalizeToGlobalMeasureMxl,
  resolveHitMeasureMxl,
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
// 선택+다음 마디 경량 미리보기 — 로컬 2 → 전곡 다음 마디
const lightPair = lightOsmdPreviewMeasureRange(42, 100);
if (lightPair.start !== 42 || lightPair.end !== 43) {
  throw new Error(`light preview range expected 42-43 got ${lightPair.start}-${lightPair.end}`);
}
if (normalizeToGlobalMeasureMxl(2, lightPair) !== 43) {
  throw new Error('light pair: local 2 should map to global 43');
}
const lightLast = lightOsmdPreviewMeasureRange(100, 100);
if (lightLast.start !== 100 || lightLast.end !== 100) {
  throw new Error('last measure light preview should not invent m+1');
}
// 경량 2칸: OSMD가 중복/로컬 번호를 줘도 둘째 칸 → start+1
if (resolveHitMeasureMxl(42, 0, lightPair) !== 42) {
  throw new Error('column 0 must map to start');
}
if (resolveHitMeasureMxl(42, 1, lightPair) !== 43) {
  throw new Error('column 1 must map to start+1 even if OSMD repeats 42');
}
if (resolveHitMeasureMxl(1, 1, lightPair) !== 43) {
  throw new Error('column 1 must map to start+1 even if OSMD reports local 1');
}
if (resolveHitMeasureMxl(4, null, r33) !== 33) {
  throw new Error('page span>2 should still use normalize (local 4 → 33)');
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

// 교차 마디 diminuendo: 선택+다음 필터에 start·stop이 모두 남아야 OSMD가 hairpin을 그림
const wedgeSample = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="42">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="below"><direction-type><wedge type="diminuendo"/></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="43">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <direction placement="below"><direction-type><wedge type="stop"/></direction-type></direction>
    </measure>
  </part>
</score-partwise>`;
const wedgePair = lightOsmdPreviewMeasureRange(42, 43);
const wedgeFiltered = filterMusicXmlToMeasureRange(wedgeSample, wedgePair.start, wedgePair.end);
if (!/wedge type="diminuendo"/.test(wedgeFiltered) || !/wedge type="stop"/.test(wedgeFiltered)) {
  throw new Error('light pair filter must keep diminuendo start and stop across measures');
}
if (!/<measure number="42"/.test(wedgeFiltered) || !/<measure number="43"/.test(wedgeFiltered)) {
  throw new Error('light pair filter must include both measures');
}
const wedgeAffected = affectedMeasuresFromFixes([
  {
    kind: 'insertWedge',
    partId: 'P1',
    measureMxl: '42',
    toMeasureMxl: '43',
    wedgeType: 'diminuendo',
  },
]);
if (!wedgeAffected.some((a) => a.partId === 'P1' && a.measureMxl === 43)) {
  throw new Error('insertWedge toMeasureMxl must mark next measure affected');
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

console.log('OK page measure range + light pair preview + measure nav index + affected measures');
