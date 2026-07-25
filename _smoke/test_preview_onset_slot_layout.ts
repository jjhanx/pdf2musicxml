/**
 * Preview play-order layout — m17 F4/Bb4/E5 same column when same play order.
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
import { HITL_PLAY_ORDER_ATTR, readPlayOrder } from '../shared/musicXmlPlayOrder';
import { assignPreviewLyricSlotsToMeasure, OSMD_LYRIC_SLOT_ATTR, readPreviewLyricSlot } from '../shared/musicXmlPreviewOnsetLayout';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
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
    if (measure.getAttribute('number') === '17') {
      for (const note of [...measure.children]) {
        if (local(note) !== 'note') continue;
        const p = pitch(note as Element);
        if (p === 'F4' || p === 'Bb4' || p === 'E5') {
          (note as Element).setAttribute(HITL_PLAY_ORDER_ATTR, '2');
        }
      }
    }
    realignMeasureDefaultXFromTimelineForOsmd(measure);
    assignPreviewLyricSlotsToMeasure(measure);
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
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;

  const f4 = [...m17.children].find(
    (c) =>
      local(c) === 'note' &&
      pitch(c as Element) === 'F4' &&
      !c.querySelector('chord,*|chord') &&
      c.getAttribute(HITL_PLAY_ORDER_ATTR) === '2',
  ) as Element;
  const e5 = [...m17.children].find(
    (c) =>
      local(c) === 'note' &&
      pitch(c as Element) === 'E5' &&
      !c.querySelector('chord,*|chord') &&
      c.getAttribute(HITL_PLAY_ORDER_ATTR) === '2',
  ) as Element;

  if (!f4 || !e5) throw new Error('m17 notes missing');

  const bb = [...m17.children].find(
    (c) => local(c) === 'note' && pitch(c as Element) === 'Bb4' && c.querySelector('chord,*|chord'),
  ) as Element;

  const parallelX = new Set([f4.getAttribute('default-x'), bb?.getAttribute('default-x'), e5.getAttribute('default-x')]);
  if (parallelX.size !== 1) throw new Error(`parallel default-x differ: ${[...parallelX].join(', ')}`);

  const parallelOrder = new Set([readPlayOrder(f4), readPlayOrder(bb), readPlayOrder(e5)]);
  if (parallelOrder.size !== 1 || parallelOrder.values().next().value !== 2) {
    throw new Error(`parallel play order wrong: ${[...parallelOrder].join(', ')}`);
  }

  if (readPreviewLyricSlot(f4) == null || readPreviewLyricSlot(e5) == null) {
    throw new Error('lyric slots missing');
  }

  console.log('OK preview play order layout', {
    parallelX: [...parallelX][0],
    playOrder: 2,
    lyricF4: readPreviewLyricSlot(f4),
    lyricE5: readPreviewLyricSlot(e5),
    attrs: [HITL_PLAY_ORDER_ATTR, OSMD_LYRIC_SLOT_ATTR],
  });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
