import { readFileSync, writeFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
});

const xml = readFileSync('_smoke/_raw_cheongsan.xml', 'utf8');
const rep = repairTimelineForOsmdPreview(xml);
writeFileSync('_smoke/_repaired.xml', rep);
console.log('Done');
