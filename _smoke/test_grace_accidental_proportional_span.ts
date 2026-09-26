/**
 * 꾸밈음 + 임시표(#)가 있을 때 음표 박자 비례 마디 span 확장 및 전 성부 마디 길이 통일 검증.
 * Run: npx tsx _smoke/test_grace_accidental_proportional_span.ts
 */
import { JSDOM } from 'jsdom';
import { applyPlayOrderLayoutToXml } from '../shared/musicXmlPlayOrder';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';
import {
  PREVIEW_LAYOUT_BASE_X,
  PREVIEW_LAYOUT_SPAN,
  measureRequiredVisualSpan,
  buildScoreMeasureLayoutSpans,
} from '../shared/musicXmlPreviewOnsetLayout';

const dom = new JSDOM('<!DOCTYPE html><html></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
});

// Part 1: 꾸밈음 + #을 가진 8분음표 포함 (43마디 PR 패턴)
// Part 2: 4분음표 4개 (PL 패턴)
const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="43">
      <attributes><divisions>12</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><grace/><pitch><step>G</step><octave>4</octave><alter>1</alter></pitch><voice>1</voice><type>16th</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>6</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice><type>16th</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice><type>16th</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>9</duration><voice>1</voice><type>eighth</type><dot/><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice><type>16th</type><staff>1</staff></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="43">
      <attributes><divisions>12</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>12</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>12</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>D</step><octave>2</octave></pitch><duration>12</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>12</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

const docBefore = parseMusicXmlDocument(xml)!;
const m1 = docBefore.querySelector("part[id='P1'] measure[number='43']")!;
const requiredSpanP1 = measureRequiredVisualSpan(m1, PREVIEW_LAYOUT_SPAN);

if (requiredSpanP1 <= PREVIEW_LAYOUT_SPAN) {
  throw new Error(`expected requiredSpanP1 > ${PREVIEW_LAYOUT_SPAN}, got ${requiredSpanP1}`);
}

const laidOutXml = applyPlayOrderLayoutToXml(xml);
const doc = parseMusicXmlDocument(laidOutXml)!;

const p1Notes = [...doc.querySelectorAll("part[id='P1'] note")];
const p2Notes = [...doc.querySelectorAll("part[id='P2'] note")];

const g4 = p1Notes[3]!;
const a4 = p1Notes[5]!;

const g4X = parseFloat(g4.getAttribute('data-osmd-layout-x') ?? '0');
const a4X = parseFloat(a4.getAttribute('data-osmd-layout-x') ?? '0');
const eighthGap = a4X - g4X;

if (eighthGap < 70) {
  throw new Error(`expected gap between G4 and A4 >= 70, got ${eighthGap}`);
}

// 16분음표 간격 확인
const c5_1 = p1Notes[6]!;
const c5_2 = p1Notes[7]!;
const c5_1X = parseFloat(c5_1.getAttribute('data-osmd-layout-x') ?? '0');
const c5_2X = parseFloat(c5_2.getAttribute('data-osmd-layout-x') ?? '0');
const sixteenthGap = c5_2X - c5_1X;

if (Math.abs(sixteenthGap * 2 - eighthGap) > 1.0) {
  throw new Error(`sixteenth gap ${sixteenthGap} must be half of eighth gap ${eighthGap}`);
}

// Part 2 (PL)도 동일한 통일된 span으로 4분음표 간격 유지 확인
const p2_1 = p2Notes[0]!;
const p2_2 = p2Notes[1]!;
const p2_3 = p2Notes[2]!;
const p2_1X = parseFloat(p2_1.getAttribute('data-osmd-layout-x') ?? '0');
const p2_2X = parseFloat(p2_2.getAttribute('data-osmd-layout-x') ?? '0');
const p2_3X = parseFloat(p2_3.getAttribute('data-osmd-layout-x') ?? '0');
const quarterGap = p2_2X - p2_1X;

if (Math.abs(quarterGap - eighthGap * 2) > 1.0) {
  throw new Error(`quarter gap ${quarterGap} in Part 2 must be twice of eighth gap ${eighthGap}`);
}

// Part 1의 onset 24 (A4)와 Part 2의 onset 24 (p2_3)의 x 좌표 일치 확인
if (Math.abs(a4X - p2_3X) > 0.1) {
  throw new Error(`Part 1 A4 x (${a4X}) and Part 2 note 3 x (${p2_3X}) at onset 24 must match across parts`);
}

console.log('OK grace accidental proportional span test passed:', {
  eighthGap,
  sixteenthGap,
  quarterGap,
  a4X,
  p2_3X,
  requiredSpan: requiredSpanP1,
});
