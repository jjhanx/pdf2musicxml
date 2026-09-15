/**
 * Unpaired octave-shift must not reach OSMD (realValue crash).
 * Run: npx tsx _smoke/test_s_m38_octave_shift_realvalue.ts
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { demoteOctaveShiftsForOsmdPreview } from '../shared/musicXmlOctaveShiftOsmd.ts';

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, '..');

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.DOMParser = dom.window.DOMParser;
  g.XMLSerializer = dom.window.XMLSerializer;
  g.Node = dom.window.Node;
  g.Element = dom.window.Element;
  g.HTMLElement = dom.window.HTMLElement;
  g.SVGElement = dom.window.SVGElement;
  return dom;
}

function filterP1(xml: string, from: number, to: number): string {
  const dom = new JSDOM(xml, { contentType: 'application/xml' });
  const doc = dom.window.document;
  for (const part of [...doc.querySelectorAll('part')]) {
    if (part.getAttribute('id') !== 'P1') part.remove();
  }
  for (const sp of [...doc.querySelectorAll('score-part')]) {
    if (sp.getAttribute('id') !== 'P1') sp.remove();
  }
  for (const m of [...doc.querySelectorAll('part > measure')]) {
    const n = Number(m.getAttribute('number') || 0);
    if (n < from || n > to) m.remove();
  }
  return new dom.window.XMLSerializer().serializeToString(doc);
}

async function loadReview(): Promise<string> {
  const buf = readFileSync(resolve(ROOT, 'omr-work-014f2b6c.zip'));
  const z = await JSZip.loadAsync(buf);
  const mxl = await z.file('review.mxl')!.async('nodebuffer');
  const mz = await JSZip.loadAsync(mxl);
  const name = Object.keys(mz.files).find((n) => n.endsWith('.xml') && !n.startsWith('META'))!;
  return mz.file(name)!.async('string');
}

async function renderOsmd(xml: string): Promise<void> {
  const dom = setupDom();
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  Object.defineProperty(host, 'clientWidth', { get: () => 900 });
  Object.defineProperty(host, 'clientHeight', { get: () => 700 });
  (host as any).getBoundingClientRect = () => ({
    width: 900,
    height: 700,
    top: 0,
    left: 0,
    bottom: 700,
    right: 900,
    x: 0,
    y: 0,
    toJSON() {},
  });
  const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawMeasureNumbers: false,
  });
  await osmd.load(xml);
  osmd.render();
}

async function main() {
  setupDom();
  // unit: demote removes octave-shift
  const tiny = `<?xml version="1.0"?><score-partwise version="3.1"><part id="P1"><measure number="1">
    <direction><direction-type><octave-shift type="up" size="8" number="1">8va</octave-shift></direction-type></direction>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
  </measure></part></score-partwise>`;
  const demoted = demoteOctaveShiftsForOsmdPreview(tiny);
  if (/octave-shift/i.test(demoted)) {
    console.error('FAIL demote left octave-shift');
    process.exit(1);
  }
  if (!/8va/.test(demoted)) {
    console.error('FAIL demote missing 8va words');
    process.exit(1);
  }

  const full = await loadReview();
  const raw = filterP1(full, 37, 42);
  if (!(raw.match(/octave-shift/g) || []).length) {
    console.error('FAIL fixture missing unpaired octave-shift on S');
    process.exit(1);
  }
  const sanitized = demoteOctaveShiftsForOsmdPreview(raw);
  if ((sanitized.match(/octave-shift/g) || []).length) {
    console.error('FAIL sanitized still has octave-shift');
    process.exit(1);
  }

  let rawCrashed = false;
  try {
    await renderOsmd(raw);
  } catch (e: any) {
    rawCrashed = true;
    const msg = String(e?.message || e);
    if (!/realValue/i.test(msg) && !/undefined/i.test(msg)) {
      console.warn('raw failed with unexpected message:', msg);
    }
  }
  await renderOsmd(sanitized);
  if (!rawCrashed) {
    console.warn('note: raw unpaired 8va did not crash in this OSMD/jsdom env');
  }
  console.log('ok s m38 octave-shift realValue sanitize');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
