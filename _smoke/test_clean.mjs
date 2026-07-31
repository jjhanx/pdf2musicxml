import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
const xml = readFileSync('_smoke/_raw_cheongsan.xml', 'utf8');
const dom = new JSDOM(xml, { contentType: 'application/xml' });
const doc = dom.window.document;
function xmlLocalName(el) { return el.localName ? el.localName.toLowerCase() : el.tagName.toLowerCase(); }
function hasNoteAfter(measure, index) {
  for (let i = index + 1; i < measure.children.length; i++) {
    if (xmlLocalName(measure.children[i]) === 'note') return true;
  }
  return false;
}
function hasNoteBefore(measure, index) {
  for (let i = 0; i < index; i++) {
    if (xmlLocalName(measure.children[i]) === 'note') return true;
  }
  return false;
}
for (const measure of doc.querySelectorAll('part[id="P5"] measure[number="25"]')) {
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag !== 'backup' && tag !== 'forward') continue;
    const idx = [...measure.children].indexOf(child);
    const hnA = hasNoteAfter(measure, idx);
    const hnB = hasNoteBefore(measure, idx);
    console.log(tag, 'at', idx, 'hasNoteAfter:', hnA, 'hasNoteBefore:', hnB);
    if (!hnA || !hnB) {
      child.remove();
      console.log('REMOVED');
    }
  }
}
