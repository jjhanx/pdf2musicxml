/**
 * Play-order columns advance in PO number order, not document first-seen order.
 * Run: npx tsx _smoke/test_play_order_sorted_po_column_layout.ts
 */
import { JSDOM } from 'jsdom';
import {
  applyPlayOrderLayoutToMeasure,
  buildPlayOrderSlotOnsets,
  defaultPlayOrdersFromTimeline,
  HITL_PLAY_ORDER_ATTR,
} from '../shared/musicXmlPlayOrder';

const dom = new JSDOM('<!DOCTYPE html><html></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

const doc = new DOMParser().parseFromString(xml, 'text/xml');
const measure = doc.querySelector('measure')!;
const leaders = [...measure.children].filter(
  (c) => c.localName === 'note' && !c.querySelector('chord'),
) as Element[];

// Document lists po 1,3,2,4 — layout must still be po1 < po2 < po3 < po4 left-to-right.
leaders[0]!.setAttribute(HITL_PLAY_ORDER_ATTR, '1');
leaders[1]!.setAttribute(HITL_PLAY_ORDER_ATTR, '3');
leaders[2]!.setAttribute(HITL_PLAY_ORDER_ATTR, '2');
leaders[3]!.setAttribute(HITL_PLAY_ORDER_ATTR, '4');

const defaults = defaultPlayOrdersFromTimeline(measure, 1);
const slots = buildPlayOrderSlotOnsets(leaders, defaults, measure);
for (const po of [1, 2, 3, 4]) {
  const want = (po - 1) * 2;
  if (slots.get(po) !== want) throw new Error(`po${po} onset ${slots.get(po)} want ${want}`);
}

applyPlayOrderLayoutToMeasure(measure);
const lx = (n: Element) => parseFloat(n.getAttribute('data-osmd-layout-x') ?? '0');
const byPo = [1, 2, 3, 4].map((po) => ({
  po,
  x: lx(leaders.find((l) => l.getAttribute(HITL_PLAY_ORDER_ATTR) === String(po))!),
}));
for (let i = 1; i < byPo.length; i++) {
  if (byPo[i]!.x <= byPo[i - 1]!.x) {
    throw new Error(`po columns must increase: ${JSON.stringify(byPo)}`);
  }
  if (i > 1) {
    const gap = byPo[i]!.x - byPo[i - 1]!.x;
    const prevGap = byPo[i - 1]!.x - byPo[i - 2]!.x;
    if (Math.abs(gap - prevGap) > 0.5) {
      throw new Error(`uneven quarter gaps: ${JSON.stringify(byPo)}`);
    }
  }
}

console.log('OK sorted PO column layout', byPo);
