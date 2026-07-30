/**
 * Play-order layout: PO number order + min duration step per column.
 * Run: npx tsx _smoke/test_play_order_slot_grid.ts
 */
import { JSDOM } from 'jsdom';
import {
  buildPlayOrderSlotOnsets,
  defaultPlayOrdersFromTimeline,
  effectivePlayOrder,
  HITL_PLAY_ORDER_ATTR,
  applyPlayOrderLayoutToMeasure,
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
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><chord/><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <forward><duration>2</duration><voice>2</voice></forward>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><chord/><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><chord/><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><chord/><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><chord/><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

const doc = new DOMParser().parseFromString(xml, 'text/xml');
const measure = doc.querySelector('measure')!;
const leaders = [...measure.children].filter(
  (c) => c.localName === 'note' && !c.querySelector('chord'),
) as Element[];

// #0 opening=1, #1 E5=2, #2 F5=3, #3 [F4,Bb4]=2, #4 tetra=4
leaders[0]!.setAttribute(HITL_PLAY_ORDER_ATTR, '1');
leaders[1]!.setAttribute(HITL_PLAY_ORDER_ATTR, '2');
leaders[2]!.setAttribute(HITL_PLAY_ORDER_ATTR, '3');
leaders[3]!.setAttribute(HITL_PLAY_ORDER_ATTR, '2');
leaders[4]!.setAttribute(HITL_PLAY_ORDER_ATTR, '4');

const defaults = defaultPlayOrdersFromTimeline(measure, 1);
const slots = buildPlayOrderSlotOnsets(leaders, defaults, measure);
// po1 onset 0; po2 min(E5@2,F4@2)=2; po3 F5@3; po4 tetra@4
if (slots.get(1) !== 0) throw new Error(`po1 onset ${slots.get(1)}`);
if (slots.get(2) !== 2) throw new Error(`po2 onset ${slots.get(2)} want 2`);
if (slots.get(3) !== 3) throw new Error(`po3 onset ${slots.get(3)} want 3`);
if (slots.get(4) !== 4) throw new Error(`po4 onset ${slots.get(4)} want 4`);

applyPlayOrderLayoutToMeasure(measure);
const lx = (n: Element) => n.getAttribute('data-osmd-layout-x');
if (lx(leaders[1]!) !== lx(leaders[3]!)) {
  throw new Error(`po2 E5 and F4 must share layout-x: ${lx(leaders[1]!)} vs ${lx(leaders[3]!)}`);
}
if (parseFloat(lx(leaders[3]!)!) >= parseFloat(lx(leaders[2]!)!)) {
  throw new Error(`po2 must be left of po3: ${lx(leaders[3]!)} vs ${lx(leaders[2]!)}`);
}

console.log('OK play-order slot grid', {
  slots: Object.fromEntries(slots),
  e5: lx(leaders[1]!),
  f4po2: lx(leaders[3]!),
  f5: lx(leaders[2]!),
  tetra: lx(leaders[4]!),
});
