import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { measureTimelineEndDivisions, repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairMissingNoteTypesForOsmdPreview, repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element });

// Import split from AudiverisInspectPanel is hard — use python-style check on output XML file
// Run: npx tsx this after exporting preview xml

import { serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }

function voiceSum(measure: Element): Record<string, number> {
  const by: Record<string, number> = {};
  for (const note of [...measure.children]) {
    if (local(note) !== 'note') continue;
    if (note.querySelector('chord') || note.querySelector('grace')) continue;
    const v = note.querySelector('voice')?.textContent?.trim() ?? '1';
    const d = parseInt(note.querySelector('duration')?.textContent ?? '0', 10);
    by[v] = (by[v] ?? 0) + d;
  }
  return by;
}

function analyze(xml: string) {
  const doc = parseMusicXmlDocument(xml)!;
  for (const pid of ['P1', 'P5__PL', 'P5__PR']) {
    const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === pid);
    if (!part) { console.log(pid, 'MISSING'); continue; }
    for (const mn of ['25', '26', '27']) {
      const m = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === mn) as Element | undefined;
      if (!m) continue;
      const end = measureTimelineEndDivisions(m);
      const voices = voiceSum(m);
      console.log(`${pid} m${mn}: end=${end} voices=${JSON.stringify(voices)}`);
    }
  }
}

let raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
console.log('=== RAW (after timeline only) ===');
analyze(repairTimelineForOsmdPreview(raw));

// simulate verbatim split minimally via reading test output - use exec of build from node
console.log('\n=== Need full preview XML ===');
