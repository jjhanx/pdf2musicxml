/**
 * Multi-voice underfull must NOT insert forward before backup (po / cursor corruption).
 */
import { JSDOM } from 'jsdom';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';
import { HITL_PLAY_ORDER_ATTR } from '../shared/musicXmlPlayOrder';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';

const dom = new JSDOM('<!DOCTYPE html><html></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  document: dom.window.document,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

const xml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="17">
      <attributes>
        <divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note data-hitl-play-order="1"><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note data-hitl-play-order="2"><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note>
      <note data-hitl-play-order="3"><pitch><step>F</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note>
      <backup><duration>4</duration></backup>
      <forward><duration>2</duration><voice>2</voice></forward>
      <note data-hitl-play-order="2"><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type></note>
      <note data-hitl-play-order="4"><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type></note>
      <note data-hitl-play-order="5"><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

let out = repairUnderfullMeasuresForOsmdPreview(xml);
out = repairTimelineForOsmdPreview(out);
out = repairUnderfullMeasuresForOsmdPreview(out);
out = repairTimelineForOsmdPreview(out);

const doc = new DOMParser().parseFromString(out, 'text/xml');
const m = doc.querySelector('measure')!;
const forwardsBeforeBackup: Element[] = [];
let seenBackup = false;
for (const c of [...m.children]) {
  const tag = c.localName?.toLowerCase() ?? '';
  if (tag === 'backup') {
    seenBackup = true;
    continue;
  }
  if (tag === 'forward' && !seenBackup) forwardsBeforeBackup.push(c);
}

if (forwardsBeforeBackup.length > 0) {
  throw new Error(
    `must not insert forward before backup in multi-voice measure (got ${forwardsBeforeBackup.length})`,
  );
}

const notes = [...m.querySelectorAll('note')].filter((n) => !n.querySelector('chord'));
const po2 = notes.filter((n) => n.getAttribute(HITL_PLAY_ORDER_ATTR) === '2');
if (po2.length < 2) {
  throw new Error(`po=2 must survive underfull+repair (got ${po2.length}: ${notes.map((n) => n.getAttribute(HITL_PLAY_ORDER_ATTR)).join(',')})`);
}

console.log('ok: multi-voice underfull skips voice pad; po=2 preserved');
