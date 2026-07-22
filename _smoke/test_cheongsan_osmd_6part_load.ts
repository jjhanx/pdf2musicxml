/** P4 rest without <type> breaks OSMD — repairMissingNoteTypesForOsmdPreview */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1600px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

async function main() {
  let xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  xml = repairMissingNoteTypesForOsmdPreview(repairTimelineForOsmdPreview(xml));
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse');
  const p4 = doc.querySelector('part[id="P4"], *|part[id="P4"]');
  const m2 = p4 && [...p4.children].find((c) => c.getAttribute('number') === '2');
  const note = m2?.querySelector('note, *|note');
  const typ = note?.querySelector('type, *|type')?.textContent;
  if (typ !== 'whole') throw new Error(`P4 m2 rest type expected whole, got ${typ}`);

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.render();
  console.log('cheongsan 6-part osmd load ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
