/**
 * Step-through: where does m17 po=2 get cleared?
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  document: dom.window.document,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  collectStaffNoteOnsets,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { HITL_PLAY_ORDER_ATTR, sanitizeConflictingPlayOrders } from '../shared/musicXmlPlayOrder';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function dump(m: Element, label: string) {
  console.log('---', label);
  for (const c of [...m.children]) {
    if (local(c) === 'backup' || local(c) === 'forward') {
      console.log(
        ' ',
        local(c),
        'dur',
        c.querySelector('duration')?.textContent,
        'v',
        c.querySelector('voice')?.textContent,
      );
      continue;
    }
    if (local(c) !== 'note' || c.querySelector('chord')) continue;
    const step = c.querySelector('step')?.textContent ?? '';
    const oct = c.querySelector('octave')?.textContent ?? '';
    const alt = c.querySelector('alter')?.textContent;
    const acc = alt === '-1' ? 'b' : '';
    console.log(
      ' ',
      `${step}${acc}${oct}`,
      `v${c.querySelector('voice')?.textContent}`,
      `po=${c.getAttribute(HITL_PLAY_ORDER_ATTR)}`,
    );
  }
  const onsets = collectStaffNoteOnsets(m);
  const byPo = new Map<string, Array<{ pitch: string; onset: number; v: string }>>();
  for (const [note, onset] of onsets) {
    if (note.querySelector('chord')) continue;
    const po = note.getAttribute(HITL_PLAY_ORDER_ATTR);
    if (!po) continue;
    const step = note.querySelector('step')?.textContent ?? '';
    const list = byPo.get(po) ?? [];
    list.push({
      pitch: step,
      onset,
      v: note.querySelector('voice')?.textContent ?? '?',
    });
    byPo.set(po, list);
  }
  console.log('  single-cursor po onsets', Object.fromEntries([...byPo.entries()]));
}

execSync('python _smoke/_export_463_po.py', { stdio: 'inherit' });
const raw = fs.readFileSync('_smoke/_tmp_463_po_fixed.xml', 'utf8');

let xml = repairTimelineForOsmdPreview(raw);
let doc = new DOMParser().parseFromString(xml, 'text/xml');
for (const part of [...doc.querySelectorAll('part')]) {
  if (part.getAttribute('id') !== 'P5') part.remove();
}
const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
const m = [...part.children].find(
  (c) => local(c) === 'measure' && c.getAttribute('number') === '17',
)!;
dump(m, 'after first repairTimeline (both staves)');

for (const child of [...m.children]) {
  if (local(child) === 'note') {
    const st = child.querySelector('staff')?.textContent?.trim();
    if (st && st !== '1') child.remove();
  }
}
pruneCrossStaffTimelineForOsmdPreview(m, 1);
dump(m, 'after staff1 prune');

snapshotNoteDefaultXForOsmdPreview(m);
const reordered = reorderSingleStaffTimelineByOnsetForOsmdPreview(m);
console.log('reorder changed', reordered);
dump(m, 'after reorder');

const normalized = normalizeMultiVoiceLayersForOsmdPreview(m);
console.log('normalize changed', normalized);
dump(m, 'after normalize');

const sanitized = sanitizeConflictingPlayOrders(m);
console.log('sanitize changed', sanitized);
dump(m, 'after sanitize only');

realignMeasureDefaultXFromTimelineForOsmd(m);
dump(m, 'after realign');

// Simulate second pass on full doc (only m17 in part for simplicity)
xml = new XMLSerializer().serializeToString(doc);
xml = repairTimelineForOsmdPreview(xml);
xml = repairUnderfullMeasuresForOsmdPreview(xml);
xml = repairTimelineForOsmdPreview(xml);
doc = new DOMParser().parseFromString(xml, 'text/xml');
const m2 = [...doc.querySelectorAll('measure')].find((c) => c.getAttribute('number') === '17')!;
dump(m2, 'after second repair+underfull pass');
