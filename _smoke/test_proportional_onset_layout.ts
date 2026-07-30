/**
 * 미리보기 layout = musical onset 비율 (4/4 4분음 4개 → 균등 간격).
 * Run: npx tsx _smoke/test_proportional_onset_layout.ts
 */
import { JSDOM } from 'jsdom';
import { applyPlayOrderLayoutToMeasure } from '../shared/musicXmlPlayOrder';
import { defaultXFromOnset, previewLayoutLengthUnits } from '../shared/musicXmlPreviewOnsetLayout';

const dom = new JSDOM('<!DOCTYPE html><html></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
});

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

const doc = new DOMParser().parseFromString(xml, 'text/xml');
const measure = doc.querySelector('measure')!;
applyPlayOrderLayoutToMeasure(measure);
const len = previewLayoutLengthUnits(measure);
const leaders = [...measure.children].filter((c) => c.localName === 'note') as Element[];
const lx = leaders.map((n) => parseFloat(n.getAttribute('data-osmd-layout-x') ?? '0'));
for (let i = 0; i < 4; i++) {
  const want = parseFloat(defaultXFromOnset(i * 2, len));
  if (Math.abs(lx[i]! - want) > 0.01) {
    throw new Error(`note ${i} lx ${lx[i]} want ${want}`);
  }
}
const gaps = lx.slice(1).map((x, i) => x - lx[i]!);
if (Math.max(...gaps) / Math.min(...gaps) > 1.01) {
  throw new Error(`uneven gaps ${gaps.join(', ')}`);
}
console.log('OK proportional onset layout', { lx, gaps });
