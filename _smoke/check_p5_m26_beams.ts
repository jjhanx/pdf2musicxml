import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { parseMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

const xml = repairTimelineForOsmdPreview(readFileSync('_smoke/_cheongsan_review.xml', 'utf8'));
const doc = parseMusicXmlDocument(xml)!;
const p5 = doc.querySelector('part[id="P5"], *|part[id="P5"]')!;
const m26 = [...p5.children].find((c) => c.getAttribute('number') === '26')!;
let chordBeams = 0;
for (const n of m26.querySelectorAll('note, *|note')) {
  if (n.querySelector('chord, *|chord') && n.querySelector('beam, *|beam')) chordBeams++;
}
console.log('P5 m26 chord beams', chordBeams, 'backups', m26.querySelectorAll('backup, *|backup').length);
