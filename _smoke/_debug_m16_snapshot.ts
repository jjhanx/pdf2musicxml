import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
function pitch(n: Element): string {
  const step = n.querySelector('step,*|step')?.textContent ?? '?';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '?';
  return `${step}${oct}`;
}

const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const out = join(tmpdir(), '0ea5_review.xml');
execSync(`python -c "import io,zipfile;z=zipfile.ZipFile('omr-work-0ea5ea52.zip');d=z.read('review.mxl');inner=zipfile.ZipFile(io.BytesIO(d));x=[n for n in inner.namelist() if n.endswith('.xml') and 'META' not in n.upper()][0];open(r'${out.replace(/\\/g, '\\\\')}', 'wb').write(inner.read(x))"`, { cwd: process.cwd(), stdio: 'pipe' });
const doc = new DOMParser().parseFromString(repairTimelineForOsmdPreview(fs.readFileSync(out, 'utf8')), 'text/xml');
const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
const m16 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '16')!;
console.log('repaired RAW staff1 notes:');
for (const c of [...m16.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  const st = c.querySelector('staff,*|staff')?.textContent?.trim();
  if (st && st !== '1') continue;
  console.log(`  ${pitch(c)} v=${c.querySelector('voice,*|voice')?.textContent} x=${c.getAttribute('default-x')}`);
}
for (const child of [...m16.children]) {
  if (local(child) === 'note') {
    const st = child.querySelector('staff,*|staff')?.textContent?.trim();
    if (st && st !== '1') child.remove();
  }
}
m16.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
console.log('after staff filter:');
for (const c of [...m16.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  console.log(`  ${pitch(c)} v=${c.querySelector('voice,*|voice')?.textContent} x=${c.getAttribute('default-x')}`);
}
pruneCrossStaffTimelineForOsmdPreview(m16, 1);
console.log('\nafter prune:');
for (const c of [...m16.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  console.log(`  ${pitch(c)} v=${c.querySelector('voice,*|voice')?.textContent} x=${c.getAttribute('default-x')}`);
}
snapshotNoteDefaultXForOsmdPreview(m16);
console.log('\nafter snapshot (orig):');
for (const c of [...m16.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  console.log(`  ${pitch(c)} v=${c.querySelector('voice,*|voice')?.textContent} orig=${c.getAttribute('data-osmd-orig-default-x')}`);
}
reorderSingleStaffTimelineByOnsetForOsmdPreview(m16);
normalizeMultiVoiceLayersForOsmdPreview(m16);
console.log('\nafter reorder+norm:');
for (const c of [...m16.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  console.log(`  ${pitch(c)} v=${c.querySelector('voice,*|voice')?.textContent} x=${c.getAttribute('default-x')} orig=${c.getAttribute('data-osmd-orig-default-x')}`);
}
