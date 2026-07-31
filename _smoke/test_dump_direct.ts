import { readFileSync, writeFileSync } from 'fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
});

import { applyPartLabelsToMusicXml, setPartDisplayName } from '../shared/musicXmlPartLabels.ts';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { splitGrandStaffPartsForFullScoreOsmd } from '../shared/musicXmlGrandStaffSplit.ts';
import { promoteNoteDynamicsForOsmdPreview } from '../shared/musicXmlDynamicsForOsmd.ts';
import { migrateDirectionsToNotes } from '../shared/musicXmlDirections.ts';

function buildOsmdPreviewXmlMock(rawXml: string): string {
  const scoreParts = [
    { id: 'P1', name: 'P1', displayString: 'P1' },
    { id: 'P2', name: 'P2', displayString: 'P2' },
    { id: 'P3', name: 'P3', displayString: 'P3' },
    { id: 'P4', name: 'P4', displayString: 'P4' },
    { id: 'P5', name: 'P5', displayString: 'P5' },
  ];
  let xml = applyPartLabelsToMusicXml(rawXml, scoreParts);
  xml = repairTimelineForOsmdPreview(xml);
  // xml = migrateDirectionsToNotes(xml);
  xml = promoteNoteDynamicsForOsmdPreview(xml);
  xml = splitGrandStaffPartsForFullScoreOsmd(xml, scoreParts, { verbatim: true });
  xml = repairTimelineForOsmdPreview(xml);
  return xml;
}

let xml = readFileSync('_smoke/_raw_cheongsan.xml', 'utf8');
xml = buildOsmdPreviewXmlMock(xml);
writeFileSync('_smoke/_cheongsan_preview_dump.xml', xml);
console.log('Dumped to _smoke/_cheongsan_preview_dump.xml');
