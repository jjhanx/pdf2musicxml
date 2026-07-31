import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { document: Document; DOMParser: typeof DOMParser; XMLSerializer: typeof XMLSerializer }).document =
  dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const xml = readFileSync('_smoke/x/clean_score_only.xml', 'utf8');
const doc = parseMusicXmlDocument(xml);
console.log('parse ok', Boolean(doc));
if (!doc) process.exit(1);
let mn = 0;
for (const el of doc.querySelectorAll('measure-numbering')) {
  el.remove();
  mn++;
}
console.log('removed mn tags', mn);
