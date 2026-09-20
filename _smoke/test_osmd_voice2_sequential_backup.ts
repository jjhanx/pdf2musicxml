/**
 * OSMD preview: sequential multi-voice without backup must get voice-layer backup
 * (otherwise secondary voice sits past the barline and looks “vanished”).
 * Run: npx tsx _smoke/test_osmd_voice2_sequential_backup.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizeMultiVoiceLayersForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer =
  dom.window.XMLSerializer;

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration>
        <voice>1</voice><type>whole</type><stem>up</stem><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>
        <voice>2</voice><type>quarter</type><stem>down</stem><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

const doc = new DOMParser().parseFromString(xml, 'text/xml');
const measure = doc.querySelector('measure')!;
assert.equal(normalizeMultiVoiceLayersForOsmdPreview(measure), true);
const tags: string[] = [];
for (const child of [...measure.children]) {
  const tag = (child.localName || child.tagName).toLowerCase();
  if (tag === 'note') {
    const v = child.querySelector('voice')?.textContent?.trim() || '?';
    const step = child.querySelector('step')?.textContent?.trim() || '?';
    tags.push(`v${v}:${step}`);
  } else if (tag === 'backup' || tag === 'forward') {
    tags.push(`${tag}:${child.querySelector('duration')?.textContent?.trim()}`);
  }
}
assert.deepEqual(tags, ['v1:C', 'backup:16', 'v2:E']);
console.log('ok');
