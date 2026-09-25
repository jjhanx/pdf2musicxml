import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { filterMusicXmlToMeasureRange } from '../shared/musicXmlMeasureRange.ts';
import { registerOsmdPreviewXmlForAlign, alignOsmdPreviewNotesByOnsetColumn } from '../src/osmdOnsetColumnAlignFix.ts';
import { clipOsmdMeasuresToAllocatedWidth, containOsmdMeasureNotesInAllocatedWidth } from '../src/osmdMeasureTimingWarning.ts';
import { snapOsmdTiesToNoteheads, renderOsmdTieStubs } from '../src/osmdTieFix.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  Node: dom.window.Node,
});
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', { get() { return 1200; } });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get() { return 1200; } });
dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1200, height: 800, top: 0, left: 0, right: 1200, bottom: 800 } as any);

async function main() {
  const osmdLib = await import('opensheetmusicdisplay');
  const OpenSheetMusicDisplay =
    (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

  const candidates = [
    'C:/Users/PC/.gemini/antigravity-ide/brain/a5341e9d-a693-490e-b50f-9f95f29f437b/scratch/edc34d8d_review.xml',
    path.resolve('scratch/edc34d8d_review.xml'),
  ];
  let xml = '';
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      xml = fs.readFileSync(c, 'utf-8');
      break;
    }
  }
  if (!xml && fs.existsSync(path.resolve('omr-work-edc34d8d.zip'))) {
    const { execSync } = await import('node:child_process');
    try {
      xml = execSync(`python -c "import zipfile; z=zipfile.ZipFile('omr-work-edc34d8d.zip'); m=zipfile.ZipFile(z.open('review.mxl')); print(m.read(m.namelist()[0]).decode('utf-8'))"`, { encoding: 'utf-8' });
    } catch {
      /* ignore */
    }
  }

  if (!xml) {
    console.log('Skipping: review.xml not found');
    return;
  }

  // --- 1. Test System 6 (Range 24..27) for M27 Outgoing Tie Stub ---
  {
    const previewXml = filterMusicXmlToMeasureRange(xml, 24, 27);
    const host = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(host);

    const osmd = new OpenSheetMusicDisplay(host, { backend: 'svg' });
    registerOsmdPreviewXmlForAlign(osmd, previewXml);
    await osmd.load(previewXml);
    osmd.render();

    containOsmdMeasureNotesInAllocatedWidth(host, osmd);
    clipOsmdMeasuresToAllocatedWidth(host, osmd);
    alignOsmdPreviewNotesByOnsetColumn(osmd);
    snapOsmdTiesToNoteheads(host, osmd);
    const stubs = renderOsmdTieStubs(host, osmd, previewXml);
    clipOsmdMeasuresToAllocatedWidth(host, osmd);

    console.log(`System 6 (M24..27): created ${stubs} tie stubs`);
    const outgoingStubs = host.querySelectorAll('.vf-tie-stub-outgoing');
    if (outgoingStubs.length === 0) {
      throw new Error('System 6 M27 outgoing tie stub not created!');
    }
    const stubPath = outgoingStubs[0].querySelector('path');
    const d = stubPath?.getAttribute('d') || '';
    if (!d.startsWith('M')) {
      throw new Error(`Invalid stub path d: ${d}`);
    }
    console.log(`System 6 M27 outgoing stub OK: d="${d}"`);
  }

  // --- 2. Test System 7 (Range 28..31) for M28 Incoming Tie Stub ---
  {
    const previewXml = filterMusicXmlToMeasureRange(xml, 28, 31);
    const host = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(host);

    const osmd = new OpenSheetMusicDisplay(host, { backend: 'svg' });
    registerOsmdPreviewXmlForAlign(osmd, previewXml);
    await osmd.load(previewXml);
    osmd.render();

    containOsmdMeasureNotesInAllocatedWidth(host, osmd);
    clipOsmdMeasuresToAllocatedWidth(host, osmd);
    alignOsmdPreviewNotesByOnsetColumn(osmd);
    snapOsmdTiesToNoteheads(host, osmd);
    const stubs = renderOsmdTieStubs(host, osmd, previewXml);
    clipOsmdMeasuresToAllocatedWidth(host, osmd);

    console.log(`System 7 (M28..31): created ${stubs} tie stubs`);
    const incomingStubs = host.querySelectorAll('.vf-tie-stub-incoming');
    if (incomingStubs.length === 0) {
      throw new Error('System 7 M28 incoming tie stub not created!');
    }
    const stubPath = incomingStubs[0].querySelector('path');
    const d = stubPath?.getAttribute('d') || '';
    if (!d.startsWith('M')) {
      throw new Error(`Invalid stub path d: ${d}`);
    }
    console.log(`System 7 M28 incoming stub OK: d="${d}"`);
  }

  console.log('test_cross_system_tie_stubs: ALL OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
