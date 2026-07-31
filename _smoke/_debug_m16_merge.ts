import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  mergeSameOnsetVoicesForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer });
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function pitch(n: Element): string {
  const step = n.querySelector('step,*|step')?.textContent ?? '?';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '?';
  return `${step}${oct}`;
}

function transform(measure: Element, label: string): void {
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
  console.log(`\n${label} BEFORE merge:`);
  for (const c of [...measure.children]) {
    if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
    console.log(`  ${pitch(c)} v=${c.querySelector('voice,*|voice')?.textContent} x=${c.getAttribute('default-x')}`);
  }
  const changed = mergeSameOnsetVoicesForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
  console.log(`${label} merge changed=${changed} AFTER:`);
  for (const c of [...measure.children]) {
    if (local(c) !== 'note') continue;
    const ch = c.querySelector('chord,*|chord') ? '*' : '';
    console.log(`  ${pitch(c)}${ch} v=${c.querySelector('voice,*|voice')?.textContent} x=${c.getAttribute('default-x')} type=${c.querySelector('type,*|type')?.textContent}`);
  }
}

const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const out = join(tmpdir(), '0ea5_review.xml');
execSync(`python -c "import io,zipfile;z=zipfile.ZipFile('omr-work-0ea5ea52.zip');d=z.read('review.mxl');inner=zipfile.ZipFile(io.BytesIO(d));x=[n for n in inner.namelist() if n.endswith('.xml') and 'META' not in n.upper()][0];open(r'${out.replace(/\\/g, '\\\\')}', 'wb').write(inner.read(x))"`, { cwd: process.cwd(), stdio: 'pipe' });
const raw = fs.readFileSync(out, 'utf8');
let xml = repairTimelineForOsmdPreview(raw);
const doc = new DOMParser().parseFromString(xml, 'text/xml');
const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
const m16 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '16')!;
transform(m16, 'm16');
