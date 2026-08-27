/**
 * interleaved multi-voice + mid G must stay between notes after
 * normalizeMultiVoiceLayersForOsmdPreview (not promoted to measure header).
 *
 * Run: npx tsx _smoke/test_mid_clef_survives_voice_normalize.ts
 */
import { JSDOM } from 'jsdom';
import { normalizeMultiVoiceLayersForOsmdPreview } from '../shared/musicXmlTimelineCleanup';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>2</voice></note>
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>2</voice></note>
    </measure>
  </part>
</score-partwise>`;

function local(el: Element): string {
  return (el.localName || el.tagName).toLowerCase().replace(/^.*:/, '');
}

function tags(m: Element): string[] {
  return [...m.children].map((el) => {
    const t = local(el);
    if (t === 'note') {
      const step = el.querySelector('step, *|step')?.textContent ?? '?';
      const v = el.querySelector('voice, *|voice')?.textContent ?? '?';
      return `note:${step}v${v}`;
    }
    if (t === 'attributes') {
      const sign = el.querySelector('sign, *|sign')?.textContent ?? '?';
      return `attrs:${sign}`;
    }
    return t;
  });
}

function main() {
  const doc = new DOMParser().parseFromString(SAMPLE, 'text/xml');
  const measure = doc.querySelector('measure')!;
  const changed = normalizeMultiVoiceLayersForOsmdPreview(measure);
  const after = tags(measure);
  if (!changed) throw new Error(`expected normalize to run; after=${after.join(',')}`);
  const gi = after.indexOf('attrs:G');
  if (gi < 0) throw new Error(`mid G missing: ${after.join(',')}`);
  if (gi === 1 && after[0] === 'attrs:F') {
    throw new Error(`mid G promoted to header: ${after.join(',')}`);
  }
  if (gi === 0 || !after[gi - 1]!.startsWith('note:')) {
    throw new Error(`mid G not after a note: ${after.join(',')}`);
  }
  console.log('mid_clef_survives_voice_normalize ok', after.join(' '));
}

main();
