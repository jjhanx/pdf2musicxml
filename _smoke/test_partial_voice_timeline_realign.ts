/**
 * partial voice — preview timeline을 연주순번 column onset에 맞춤 (SVG 없이).
 * Run: npx tsx _smoke/test_partial_voice_timeline_realign.ts
 */
import { JSDOM } from 'jsdom';
import {
  HITL_PLAY_ORDER_ATTR,
  reorderPlayOrderDocumentOrderInXml,
  realignPlayOrderColumnTimelinesInXml,
} from '../shared/musicXmlPlayOrder';
import { collectVoiceParallelNoteOnsets, repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { DOMParser: typeof DOMParser; XMLSerializer: typeof XMLSerializer }).DOMParser =
  dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer = dom.window.XMLSerializer;

const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>PL</part-name></score-part></part-list>
  <part id="P5">
    <measure number="33">
      <attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>6</duration><type>16th</type><voice>1</voice><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>6</duration><type>16th</type><voice>1</voice><staff>2</staff></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>12</duration><type>eighth</type><voice>1</voice><staff>2</staff></note>
      <backup><duration>87</duration></backup>
      <forward><duration>18</duration><voice>2</voice></forward>
      <note ${HITL_PLAY_ORDER_ATTR}="1"><pitch><step>A</step><octave>2</octave></pitch><duration>48</duration><type>half</type><voice>2</voice><staff>2</staff></note>
      <note ${HITL_PLAY_ORDER_ATTR}="2"><pitch><step>A</step><octave>2</octave></pitch><duration>24</duration><type>quarter</type><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

const step = realignPlayOrderColumnTimelinesInXml(reorderPlayOrderDocumentOrderInXml(SAMPLE));
const docStep = parseMusicXmlDocument(step)!;
const measureStep = [...docStep.querySelectorAll('measure')][0]!;
const onsetsStep = collectVoiceParallelNoteOnsets(measureStep);
const v2po1Step = onsetsStep.get(
  [...measureStep.querySelectorAll('note')].find((n) => n.getAttribute(HITL_PLAY_ORDER_ATTR) === '1')!,
);
if (v2po1Step !== 0) throw new Error(`xml path v2 po1 onset ${v2po1Step}`);

const preview = repairTimelineForOsmdPreview(SAMPLE, { faithfulEditorLayout: true });
const doc = parseMusicXmlDocument(preview)!;
const measure = [...doc.querySelectorAll('measure')][0]!;
const onsets = collectVoiceParallelNoteOnsets(measure);

function onset(voice: string, po: string): number | undefined {
  for (const note of [...measure.querySelectorAll('note')]) {
    if (note.querySelector('chord')) continue;
    if (note.querySelector('voice')?.textContent !== voice) continue;
    const attr = note.getAttribute(HITL_PLAY_ORDER_ATTR);
    if (attr !== po) continue;
    return onsets.get(note);
  }
  return undefined;
}

const fwd = measure.querySelector('forward duration')?.textContent?.trim();
const v2po1 = onset('2', '1');
const v2po2 = onset('2', '2');
const v1po2 = [...measure.querySelectorAll('note')]
  .filter((n) => !n.querySelector('chord') && n.querySelector('voice')?.textContent === '1')
  .map((n) => onsets.get(n) ?? 0)[1];

console.log({ fwd, v2po1, v2po2, v1po2 });
if (v2po1 !== 0) throw new Error(`v2 po1 onset ${v2po1}, want 0`);
if (v2po2 !== v1po2) throw new Error(`v2 po2 onset ${v2po2} != v1 col2 ${v1po2}`);
console.log('partial_voice_timeline_realign ok');
