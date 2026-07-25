/**
 * 같은 명시 연주순번은 성부가 달라도 동일 default-x (마디 공통 grid).
 * Run: npx tsx _smoke/test_m17_cross_staff_play_order_x.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { unifyVoiceForSamePlayOrderPreview, readPlayOrder } from '../shared/musicXmlPlayOrder';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildMeasure(raw: string, measureNum: string): Element {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const measure = [...part.children].find(
    (c) => local(c) === 'measure' && c.getAttribute('number') === measureNum,
  ) as Element;
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  unifyVoiceForSamePlayOrderPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
  return measure;
}

function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const m17 = buildMeasure(raw, '17');

  const byPo = new Map<number, Set<string>>();
  for (const ch of [...m17.children]) {
    if (local(ch) !== 'note') continue;
    const n = ch as Element;
    if (n.querySelector('chord,*|chord')) continue;
    const po = readPlayOrder(n);
    if (po == null) continue;
    const x = n.getAttribute('default-x') ?? '';
    const set = byPo.get(po) ?? new Set<string>();
    set.add(x);
    byPo.set(po, set);
  }

  for (const [po, xs] of byPo) {
    if (xs.size > 1) {
      throw new Error(`play order ${po} must share one x across staves got ${[...xs].join(',')}`);
    }
  }

  console.log('OK cross-staff play order x', Object.fromEntries([...byPo].map(([k, v]) => [k, [...v][0]])));
}

main();
