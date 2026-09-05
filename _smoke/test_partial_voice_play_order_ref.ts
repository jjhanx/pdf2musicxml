/**
 * partial voice — `1-3` 참조 연주순번을 앵커 column onset에 맞춤.
 * Run: npx tsx _smoke/test_partial_voice_play_order_ref.ts
 */
import { JSDOM } from 'jsdom';
import {
  HITL_PLAY_ORDER_ATTR,
  realignPlayOrderColumnTimelinesInXml,
  reorderPlayOrderDocumentOrderInXml,
} from '../shared/musicXmlPlayOrder';
import { collectVoiceParallelNoteOnsets, repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { DOMParser: typeof DOMParser; XMLSerializer: typeof XMLSerializer }).DOMParser =
  dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer = dom.window.XMLSerializer;

/** a9c26 m36 PL 축소 — v1 po=3 @ onset 48, v2 `1-3` @ onset 0 → 48 */
const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>PL</part-name></score-part></part-list>
  <part id="P5">
    <measure number="36">
      <attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>36</duration><type>quarter</type><dot/><voice>1</voice><staff>2</staff></note>
      <note ${HITL_PLAY_ORDER_ATTR}="2"><pitch><step>G</step><octave>2</octave></pitch><duration>12</duration><type>16th</type><voice>1</voice><staff>2</staff></note>
      <note ${HITL_PLAY_ORDER_ATTR}="3"><pitch><step>G</step><octave>2</octave></pitch><duration>24</duration><type>eighth</type><voice>1</voice><staff>2</staff></note>
      <backup><duration>72</duration></backup>
      <note ${HITL_PLAY_ORDER_ATTR}="1-3"><pitch><step>G</step><octave>1</octave></pitch><duration>48</duration><type>half</type><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

function v1Po3Onset(measure: Element, onsets: Map<Element, number>): number {
  for (const note of [...measure.querySelectorAll('note')]) {
    if (note.querySelector('chord')) continue;
    if (note.querySelector('voice')?.textContent !== '1') continue;
    if (note.getAttribute(HITL_PLAY_ORDER_ATTR) !== '3') continue;
    return onsets.get(note) ?? -1;
  }
  throw new Error('v1 po3 not found');
}

function v2RefOnset(measure: Element, onsets: Map<Element, number>): number {
  for (const note of [...measure.querySelectorAll('note')]) {
    if (note.querySelector('chord')) continue;
    if (note.querySelector('voice')?.textContent !== '2') continue;
    if (note.getAttribute(HITL_PLAY_ORDER_ATTR) !== '1-3') continue;
    return onsets.get(note) ?? -1;
  }
  throw new Error('v2 ref 1-3 not found');
}

const before = parseMusicXmlDocument(SAMPLE)!;
const measureBefore = [...before.querySelectorAll('measure')][0]!;
const onsetsBefore = collectVoiceParallelNoteOnsets(measureBefore);
if (v2RefOnset(measureBefore, onsetsBefore) !== 0) {
  throw new Error('fixture: v2 ref should start at onset 0');
}
if (v1Po3Onset(measureBefore, onsetsBefore) !== 48) {
  throw new Error(`fixture: v1 po3 onset ${v1Po3Onset(measureBefore, onsetsBefore)}, want 48`);
}

const step = realignPlayOrderColumnTimelinesInXml(reorderPlayOrderDocumentOrderInXml(SAMPLE));
const docStep = parseMusicXmlDocument(step)!;
const measureStep = [...docStep.querySelectorAll('measure')][0]!;
const onsetsStep = collectVoiceParallelNoteOnsets(measureStep);
if (v2RefOnset(measureStep, onsetsStep) !== v1Po3Onset(measureStep, onsetsStep)) {
  throw new Error('realign xml path failed');
}

const preview = repairTimelineForOsmdPreview(SAMPLE, { faithfulEditorLayout: true });
const doc = parseMusicXmlDocument(preview)!;
const measure = [...doc.querySelectorAll('measure')][0]!;
const onsets = collectVoiceParallelNoteOnsets(measure);
const anchor = v1Po3Onset(measure, onsets);
const v2 = v2RefOnset(measure, onsets);

console.log({ anchor, v2, fwd: measure.querySelector('forward duration')?.textContent?.trim() });
if (v2 !== anchor) throw new Error(`v2 ref onset ${v2} != v1 po3 ${anchor}`);
console.log('partial_voice_play_order_ref ok');
