/**
 * 같은 voice에 잘못 붙은 동일 연주순번(옛 전파)이 앞 화음을 뒤 column으로 snap하지 않는지.
 * Run: npx tsx _smoke/test_m17_same_voice_po_no_snap.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { applyPlayOrderLayoutToMeasure, HITL_PLAY_ORDER_ATTR } from '../shared/musicXmlPlayOrder';
import { OSMD_LAYOUT_X_ATTR } from '../shared/musicXmlPreviewOnsetLayout';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function pitch(note: Element): string {
  const step = note.querySelector('step,*|step')?.textContent?.trim() ?? '';
  const alter = note.querySelector('alter,*|alter')?.textContent?.trim();
  const oct = note.querySelector('octave,*|octave')?.textContent?.trim() ?? '';
  const acc = alter === '-1' ? 'b' : alter === '1' ? '#' : '';
  return `${step}${acc}${oct}`;
}

function isChord(note: Element): boolean {
  return note.querySelector('chord,*|chord') !== null;
}

function voiceOf(note: Element): string {
  return note.querySelector('voice,*|voice')?.textContent?.trim() || '1';
}

function prepareM17(raw: string): Element {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  for (const part of [...doc.querySelectorAll('part,*|part')]) {
    if (part.getAttribute('id') !== 'P5') part.remove();
  }
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  let m17: Element | null = null;
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
    if (measure.getAttribute('number') === '17') m17 = measure;
  }
  if (!m17) throw new Error('m17 missing');
  return m17;
}

function leaders(measure: Element): Element[] {
  return [...measure.children].filter((c) => local(c) === 'note' && !isChord(c));
}

function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_play_order_234.py', {
    encoding: 'utf8',
    maxBuffer: 30e6,
  });
  const m17 = prepareM17(raw);

  // 옛 버그 재현: v2 F4 두 화음 모두 po=4
  for (const n of leaders(m17)) {
    if (voiceOf(n) === '2' && pitch(n) === 'F4') {
      n.setAttribute(HITL_PLAY_ORDER_ATTR, '4');
      for (const m of [...m17.children]) {
        // chord members after this leader
      }
    }
  }
  // also stamp chord members of those leaders
  const kids = [...m17.children];
  for (let i = 0; i < kids.length; i += 1) {
    const n = kids[i]!;
    if (local(n) !== 'note' || isChord(n)) continue;
    if (voiceOf(n) !== '2' || pitch(n) !== 'F4') continue;
    n.setAttribute(HITL_PLAY_ORDER_ATTR, '4');
    for (let j = i + 1; j < kids.length; j += 1) {
      const c = kids[j]!;
      if (local(c) !== 'note' || !isChord(c)) break;
      c.setAttribute(HITL_PLAY_ORDER_ATTR, '4');
    }
  }

  applyPlayOrderLayoutToMeasure(m17);

  const f4Leaders = leaders(m17).filter((n) => voiceOf(n) === '2' && pitch(n) === 'F4');
  if (f4Leaders.length < 2) throw new Error(`expected 2 F4 leaders, got ${f4Leaders.length}`);
  const xs = f4Leaders.map((n) => parseFloat(n.getAttribute(OSMD_LAYOUT_X_ATTR) ?? ''));
  if (xs.some((x) => !Number.isFinite(x))) throw new Error(`bad layout-x ${xs}`);
  if (Math.abs(xs[0]! - xs[1]!) < 1) {
    throw new Error(`same-voice po=4 must not snap F4 columns together: ${xs}`);
  }
  // E5 po2 should still sit near first F4 column when correct; here F4s keep musical slots
  const e5 = leaders(m17).find((n) => pitch(n) === 'E5');
  const e5x = parseFloat(e5?.getAttribute(OSMD_LAYOUT_X_ATTR) ?? '');
  if (!Number.isFinite(e5x)) throw new Error('E5 missing layout-x');
  // first F4 (onset 2) should be near E5; second F4 further right
  const sorted = [...xs].sort((a, b) => a - b);
  if (Math.abs(sorted[0]! - e5x) > 1) {
    throw new Error(`first F4 should stay at E5 column: f4=${sorted[0]} e5=${e5x}`);
  }
  if (sorted[1]! <= sorted[0]! + 20) {
    throw new Error(`second F4 should stay later: ${sorted}`);
  }
  console.log('OK same-voice po no snap', { f4xs: xs, e5x });
}

main();
