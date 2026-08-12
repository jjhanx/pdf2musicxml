/**
 * Run: npx tsx _smoke/test_tempo_direction_placement.ts
 */
import { JSDOM } from 'jsdom';
import {
  repositionDirectionsBeforeAttributesForOsmdPreview,
  ensureMetronomeOnSoundTempoDirectionsForOsmdPreview,
} from '../shared/musicXmlDirectionPlacement';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer =
  dom.window.XMLSerializer;

const BAD = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <direction placement="above">
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>72</per-minute></metronome></direction-type>
        <sound tempo="72"/>
      </direction>
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const out = repositionDirectionsBeforeAttributesForOsmdPreview(BAD, { tempoOnly: true });
const attr = out.indexOf('<attributes');
const dir = out.indexOf('<direction');
if (attr < 0 || dir < 0 || attr > dir) {
  console.error('expected attributes before direction, got:', out.slice(0, 400));
  process.exit(1);
}
console.log('OK: preview tempo reposition after attributes');

const SOUND_ONLY = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P2">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <direction placement="above"><sound tempo="72"/></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;
const filled = ensureMetronomeOnSoundTempoDirectionsForOsmdPreview(SOUND_ONLY);
if (!filled.includes('<metronome') || !filled.includes('print-object="no"')) {
  console.error('expected hidden metronome on sound-only tempo, got:', filled.slice(0, 500));
  process.exit(1);
}
console.log('OK: sound-only tempo gets hidden metronome');
