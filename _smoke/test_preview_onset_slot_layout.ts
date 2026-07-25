/**
 * Preview onset slot layout — m17 F4/Bb4/E5 same column; lyric slots assigned.
 * Run: npx tsx _smoke/test_preview_onset_slot_layout.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import {
  OSMD_ONSET_SLOT_ATTR,
  OSMD_ONSET_UNITS_ATTR,
  OSMD_LYRIC_SLOT_ATTR,
  readPreviewOnsetSlot,
  readPreviewOnsetUnits,
  readPreviewLyricSlot,
} from '../shared/musicXmlPreviewOnsetLayout';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
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
    measure.querySelectorAll('note staff,note *|staff').forEach((el) => {
      el.textContent = '1';
    });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  return new XMLSerializer().serializeToString(doc);
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const preview = buildPrPreview(raw);
  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find(
    (c) => local(c) === 'measure' && c.getAttribute('number') === '17',
  )!;

  const f4 = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'F4' && !c.querySelector('chord,*|chord'),
  ) as Element;
  const bb = [...m17.children].find((c) => local(c) === 'note' && pitch(c as Element) === 'Bb4') as Element;
  const e5 = [...m17.children].find((c) => local(c) === 'note' && pitch(c as Element) === 'E5') as Element;
  const d5Early = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'D5' && !c.querySelector('chord,*|chord'),
  ) as Element;

  if (!f4 || !bb || !e5 || !d5Early) throw new Error('m17 notes missing');

  const parallelX = new Set([f4.getAttribute('default-x'), bb.getAttribute('default-x'), e5.getAttribute('default-x')]);
  if (parallelX.size !== 1) {
    throw new Error(`parallel default-x differ: ${[...parallelX].join(', ')}`);
  }

  const parallelOnset = new Set([
    readPreviewOnsetUnits(f4),
    readPreviewOnsetUnits(bb),
    readPreviewOnsetUnits(e5),
  ]);
  if (parallelOnset.size !== 1 || parallelOnset.values().next().value !== 2) {
    throw new Error(`parallel onset units wrong: ${[...parallelOnset].join(', ')}`);
  }

  const parallelSlot = new Set([
    readPreviewOnsetSlot(f4),
    readPreviewOnsetSlot(bb),
    readPreviewOnsetSlot(e5),
  ]);
  if (parallelSlot.size !== 1) {
    throw new Error(`parallel onset slot differ: ${[...parallelSlot].join(', ')}`);
  }

  if ((readPreviewOnsetSlot(d5Early) ?? -1) >= (readPreviewOnsetSlot(f4) ?? 99)) {
    throw new Error('D5 early onset must be before parallel column');
  }

  if (readPreviewLyricSlot(f4) == null || readPreviewLyricSlot(e5) == null) {
    throw new Error('lyric slots missing');
  }
  if (readPreviewLyricSlot(bb) != null) {
    throw new Error('chord member Bb4 should not get separate lyric slot');
  }

  console.log('OK preview onset slot layout', {
    parallelX: [...parallelX][0],
    onsetSlot: [...parallelSlot][0],
    lyricF4: readPreviewLyricSlot(f4),
    lyricE5: readPreviewLyricSlot(e5),
    attrs: [OSMD_ONSET_SLOT_ATTR, OSMD_ONSET_UNITS_ATTR, OSMD_LYRIC_SLOT_ATTR],
  });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
