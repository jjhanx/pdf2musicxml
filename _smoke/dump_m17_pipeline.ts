/** Dump m17 after full verbatim preview pipeline steps. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  mergeSameOnsetVoicesForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function dumpMeasure(label: string, measure: Element) {
  const parts: string[] = [];
  for (const c of [...measure.children]) {
    const tag = local(c);
    if (tag === 'note') {
      parts.push(`${c.querySelector('step,*|step')?.textContent}${c.querySelector('octave,*|octave')?.textContent}(v${c.querySelector('voice,*|voice')?.textContent},x=${c.getAttribute('default-x')})`);
    } else if (tag === 'forward' || tag === 'backup') parts.push(`<<${tag}>>`);
    if (parts.length >= 10) break;
  }
  console.log(label + ':', parts.join(' → '));
}

function transform(m17: Element) {
  for (const child of [...m17.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff, *|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  m17.querySelectorAll('note staff, note *|staff').forEach((el) => { el.textContent = '1'; });
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  normalizeMultiVoiceLayersForOsmdPreview(m17);
  mergeSameOnsetVoicesForOsmdPreview(m17);
  realignMeasureDefaultXFromTimelineForOsmd(m17);
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17') as Element;
  transform(m17);
  dumpMeasure('after transform', m17);
  xml = new XMLSerializer().serializeToString(doc);
  xml = repairTimelineForOsmdPreview(xml);
  const doc2 = new DOMParser().parseFromString(xml, 'text/xml');
  const m172 = [...[...doc2.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!.children].find(
    (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17',
  ) as Element;
  dumpMeasure('after 2nd repairTimeline', m172);
}

main();
