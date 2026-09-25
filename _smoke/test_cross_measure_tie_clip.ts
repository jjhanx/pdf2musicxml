import { JSDOM } from 'jsdom';
import { filterMusicXmlToMeasureRange } from '../shared/musicXmlMeasureRange.ts';
import { clipOsmdMeasuresToAllocatedWidth, containOsmdMeasureNotesInAllocatedWidth } from '../src/osmdMeasureTimingWarning.ts';
import fs from 'node:fs';
import path from 'node:path';

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
    console.log('Skipping edc34d8d review.xml not found');
    return;
  }

  const scoped = filterMusicXmlToMeasureRange(xml, 28, 29);
  const osmdLib = await import('opensheetmusicdisplay');
  const OpenSheetMusicDisplay =
    (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

  const { sanitizeMusicXmlForOsmd } = await import('../shared/musicXmlMeasureRange.ts');
  const previewXml = sanitizeMusicXmlForOsmd ? sanitizeMusicXmlForOsmd(scoped) : scoped;

  const host = dom.window.document.createElement('div');
  host.style.width = '1200px';
  dom.window.document.body.appendChild(host);

  const osmd = new OpenSheetMusicDisplay(host, { backend: 'svg' });
  await osmd.load(previewXml);
  osmd.render();

  containOsmdMeasureNotesInAllocatedWidth(host, osmd);
  clipOsmdMeasuresToAllocatedWidth(host, osmd);

  // Measure 29 (measure index 1 for staff 0)
  const m1 = host.querySelectorAll('g.vf-measure')[1];
  const clipId = m1.getAttribute('clip-path')?.replace(/url\(#|\)/g, '');
  const clipRect = host.querySelector(`#${clipId} rect`);
  if (!clipRect) throw new Error('clipRect missing');

  const clipLeft = parseFloat(clipRect.getAttribute('x') || '0');
  const clipWidth = parseFloat(clipRect.getAttribute('width') || '0');
  const clipRight = clipLeft + clipWidth;

  const tiePath = m1.querySelector('.vf-stavetie path');
  if (!tiePath) throw new Error('tiePath missing');

  const d = tiePath.getAttribute('d') || '';
  const nums = [...d.matchAll(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const xs: number[] = [];
  for (let i = 0; i < nums.length; i += 2) {
    if (Number.isFinite(nums[i])) xs.push(nums[i]!);
  }

  const tieMinX = Math.min(...xs);
  const tieMaxX = Math.max(...xs);

  console.log(`Measure 29 Clip: [${clipLeft}, ${clipRight}], Tie X range: [${tieMinX}, ${tieMaxX}]`);

  if (tieMinX < clipLeft) {
    throw new Error(`Tie minX ${tieMinX} is clipped by clipLeft ${clipLeft}!`);
  }
  if (tieMaxX > clipRight) {
    throw new Error(`Tie maxX ${tieMaxX} is clipped by clipRight ${clipRight}!`);
  }

  console.log('test_cross_measure_tie_clip: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
