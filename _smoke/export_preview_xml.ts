/**
 * Export HITL preview XML for browser OSMD test.
 * Run: npx tsx _smoke/export_preview_xml.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

async function main() {
  const { buildOsmdPreviewXml } = await import('../src/AudiverisInspectPanel.tsx');
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const scoreParts = [
    { id: 'P1', displayLabel: 'S' },
    { id: 'P2', displayLabel: 'A' },
    { id: 'P3', displayLabel: 'T' },
    { id: 'P4', displayLabel: 'B' },
    { id: 'P5', displayLabel: 'P' },
  ];
  const preview = buildOsmdPreviewXml(raw, scoreParts, null, { verbatim: true });
  mkdirSync('public', { recursive: true });
  writeFileSync('public/cheongsan-preview.xml', preview, 'utf8');
  console.log('wrote public/cheongsan-preview.xml', preview.length);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
