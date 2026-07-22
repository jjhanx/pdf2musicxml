/** drawErroneousMeasures must stay off — otherwise OSMD draws ErrorUnderlay on every hasError measure */
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { readFileSync } from 'fs';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';

async function main() {
  let xml = repairMissingNoteTypesForOsmdPreview(
    repairUnderfullMeasuresForOsmdPreview(
      repairTimelineForOsmdPreview(readFileSync('_smoke/_cheongsan_review.xml', 'utf8')),
    ),
  );
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const osmd = new OpenSheetMusicDisplay(document.getElementById('host')!, { backend: 'svg' });
  await osmd.load(xml);
  const sheet = (osmd as unknown as { Sheet?: { drawErroneousMeasures?: boolean } }).Sheet;
  if (sheet?.drawErroneousMeasures) throw new Error('drawErroneousMeasures must be false by default');
  osmd.render();
  console.log('ok drawErroneousMeasures stays off');
}

void main().catch((e) => { console.error('FAIL', e); process.exit(1); });
