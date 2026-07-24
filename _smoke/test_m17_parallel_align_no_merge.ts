/**
 * m17 PR: no chord merge — E5 stays eighth + beam; OSMD graphic X aligned via hint fix.
 * Run: npx tsx _smoke/test_m17_parallel_align_no_merge.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import { collectLinkedParallelOnsetHintsFromXml, repairTimelineForOsmdPreview, reorderSingleStaffTimelineByOnsetForOsmdPreview, normalizeMultiVoiceLayersForOsmdPreview, snapshotNoteDefaultXForOsmdPreview, realignMeasureDefaultXFromTimelineForOsmd } from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { alignLinkedParallelOnsetGraphics } from '../src/osmdLinkedParallelAlignFix';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function pitch(n: Element): string {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
}

function buildPrPreview(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (local(child) === 'note') {
        const st = child.querySelector('staff,*|staff')?.textContent?.trim();
        if (st && st !== '1') child.remove();
      }
    }
    measure.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const preview = buildPrPreview(raw);
  const hints = collectLinkedParallelOnsetHintsFromXml(preview);
  if (!hints.some((h) => h.measureNumber === 17 && h.memberVoices.includes('1'))) {
    throw new Error('m17 linked parallel hint missing');
  }

  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  const e5 = [...m17.children]
    .filter((c) => local(c) === 'note')
    .find((n) => pitch(n as Element) === 'E5') as Element;
  if (!e5 || e5.querySelector('chord,*|chord')) throw new Error('E5 must not be chord');
  if (e5.querySelector('type,*|type')?.textContent !== 'eighth') throw new Error('E5 must stay eighth');
  if (e5.querySelector('beam,*|beam')?.textContent !== 'begin') throw new Error('E5 beam begin missing');

  const host = document.getElementById('h')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  alignLinkedParallelOnsetGraphics(osmd, hints);
  (osmd as { render: () => void }).render();
  console.log('m17 no-merge align ok', hints.filter((h) => h.measureNumber === 17));
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
