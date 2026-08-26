/**
 * `5-6` 연주순번 참조 → voice5 순번6과 같은 default-x.
 * voice5에 명시 attr이 없어도 timeline 기본 순번으로 해석.
 * Run: npx tsx _smoke/test_play_order_voice_ref_layout.ts
 */
import { JSDOM } from 'jsdom';
import {
  HITL_PLAY_ORDER_ATTR,
  applyPlayOrderLayoutToMeasure,
  parsePlayOrderSpec,
  readPlayOrderRef,
} from '../shared/musicXmlPlayOrder';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;

function assertSameX(a: Element, b: Element, label: string) {
  const xa = a.getAttribute('default-x');
  const xb = b.getAttribute('default-x');
  if (!xa || !xb || Math.abs(parseFloat(xa) - parseFloat(xb)) > 0.01) {
    throw new Error(`${label}: default-x mismatch ${xa} vs ${xb}`);
  }
}

function findPitch(notes: Element[], step: string, oct: string): Element {
  const n = notes.find((el) => {
    if (el.querySelector(':scope > chord')) return false;
    return (
      el.querySelector('step')?.textContent === step && el.querySelector('octave')?.textContent === oct
    );
  });
  if (!n) throw new Error(`missing ${step}${oct}`);
  return n;
}

function main() {
  const spec = parsePlayOrderSpec('5-6');
  if (!spec || spec.kind !== 'ref' || spec.voice !== 5 || spec.order !== 6) {
    throw new Error(`parse 5-6 failed: ${JSON.stringify(spec)}`);
  }

  // Case A: voice5에 명시 1..6
  {
    const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="21">
      <attributes><divisions>8</divisions></attributes>
      <note data-hitl-play-order="1"><pitch><step>F</step><octave>3</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note data-hitl-play-order="2"><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note data-hitl-play-order="3"><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note data-hitl-play-order="4"><pitch><step>D</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note data-hitl-play-order="5"><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note data-hitl-play-order="6"><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <backup><duration>48</duration></backup>
      <note data-hitl-play-order="5-6"><pitch><step>G</step><octave>3</octave></pitch><duration>16</duration><type>quarter</type><voice>6</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const doc = parseMusicXmlDocument(SAMPLE)!;
    const measure = doc.querySelector('measure')!;
    applyPlayOrderLayoutToMeasure(measure);
    const notes = [...measure.querySelectorAll('note')];
    const g4 = findPitch(notes, 'G', '4');
    const g3 = findPitch(notes, 'G', '3');
    const f3 = findPitch(notes, 'F', '3');
    if (g3.getAttribute(HITL_PLAY_ORDER_ATTR) !== '5-6') throw new Error('attr');
    if (!readPlayOrderRef(g3)) throw new Error('ref');
    assertSameX(g4, g3, 'explicit');
    if (!(parseFloat(g3.getAttribute('default-x')!) > parseFloat(f3.getAttribute('default-x')!) + 50)) {
      throw new Error(`ref must be right of po1: ${g3.getAttribute('default-x')} vs ${f3.getAttribute('default-x')}`);
    }
  }

  // Case B: voice5에 명시 순번 없음(timeline 기본) — 예전엔 musical onset 0으로 순번1에 붙음
  {
    const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="21">
      <attributes><divisions>8</divisions></attributes>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><type>eighth</type><voice>5</voice><staff>1</staff></note>
      <backup><duration>48</duration></backup>
      <note data-hitl-play-order="5-6"><pitch><step>G</step><octave>3</octave></pitch><duration>16</duration><type>quarter</type><voice>6</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const doc = parseMusicXmlDocument(SAMPLE)!;
    const measure = doc.querySelector('measure')!;
    applyPlayOrderLayoutToMeasure(measure);
    const notes = [...measure.querySelectorAll('note')];
    const g4 = findPitch(notes, 'G', '4');
    const g3 = findPitch(notes, 'G', '3');
    const f3 = findPitch(notes, 'F', '3');
    assertSameX(g4, g3, 'timeline-default');
    if (!(parseFloat(g3.getAttribute('default-x')!) > parseFloat(f3.getAttribute('default-x')!) + 50)) {
      throw new Error(
        `timeline ref must not sit on po1: ref=${g3.getAttribute('default-x')} po1=${f3.getAttribute('default-x')}`,
      );
    }
  }

  // Case C: 1748c0c9 m26 — voice1 혼합 박자·순번 없음 + voice2 `1-6`
  // 균등 그리드(6/7열)면 6·7 사이에 붙음 → 앵커 musical onset(=6번째 4분)에 맞춰야 함
  {
    const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="26">
      <attributes><divisions>16</divisions></attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>16th</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>16th</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>16th</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>16th</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>64</duration></backup>
      <note data-hitl-play-order="1-6"><pitch><step>B</step><octave>3</octave></pitch><duration>32</duration><type>half</type><voice>2</voice><staff>1</staff></note>
      <note><chord/><pitch><step>D</step><octave>4</octave></pitch><duration>32</duration><type>half</type><voice>2</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
    const doc = parseMusicXmlDocument(SAMPLE)!;
    const measure = doc.querySelector('measure')!;
    applyPlayOrderLayoutToMeasure(measure);
    const notes = [...measure.querySelectorAll('note')].filter((el) => !el.querySelector(':scope > chord'));
    const v1 = notes.filter((el) => el.querySelector('voice')?.textContent === '1');
    const a4q = v1[5]!; // 6번째 = A4 quarter
    const g4q = v1[6]!; // 7번째
    const half = notes.find((el) => el.querySelector('voice')?.textContent === '2')!;
    assertSameX(a4q, half, '1748-like-1-6');
    const x6 = parseFloat(a4q.getAttribute('default-x')!);
    const x7 = parseFloat(g4q.getAttribute('default-x')!);
    const xref = parseFloat(half.getAttribute('default-x')!);
    if (Math.abs(xref - x6) > 0.01) throw new Error(`ref not on 6th: ${xref} vs ${x6}`);
    if (xref > x6 + (x7 - x6) * 0.25) {
      throw new Error(`ref drifted toward 7th: ref=${xref} 6=${x6} 7=${x7}`);
    }
  }

  console.log('play_order_voice_ref_layout ok');
}

main();
