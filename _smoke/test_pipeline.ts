import { readFileSync, writeFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { buildOsmdPreviewXml } from '../src/AudiverisInspectPanel.tsx';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
});

const xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
const scoreParts = [
  { id: 'P1', name: 'P1', displayString: 'P1' },
  { id: 'P2', name: 'P2', displayString: 'P2' },
  { id: 'P3', name: 'P3', displayString: 'P3' },
  { id: 'P4', name: 'P4', displayString: 'P4' },
  { id: 'P5', name: 'P5', displayString: 'P5' },
];
const outXml = buildOsmdPreviewXml(xml, scoreParts, null, { verbatim: false });
writeFileSync('_smoke/_cheongsan_preview.xml', outXml);
console.log('Done');
