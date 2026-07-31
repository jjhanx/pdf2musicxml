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
for (const child of [...m16.children]) {
  if (local(child) === 'note') {
    const st = child.querySelector('staff,*|staff')?.textContent?.trim();
    if (st && st !== '1') child.remove();
  }
}
m16.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
pruneCrossStaffTimelineForOsmdPreview(m16, 1);
snapshotNoteDefaultXForOsmdPreview(m16);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m16);
normalizeMultiVoiceLayersForOsmdPreview(m16);
mergeSameOnsetVoicesForOsmdPreview(m16);
realignMeasureDefaultXFromTimelineForOsmd(m16);
function pitchWithChord(n: Element): string {
  const step = n.querySelector('step,*|step')?.textContent ?? '?';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '?';
  const ch = n.querySelector('chord,*|chord') ? '*' : '';
  return `${step}${oct}${ch}`;
}
const e5notes = [...m16.children].filter(c => local(c)==='note').map(n => n as Element).filter(n => pitchWithChord(n).startsWith('E5'));
console.log('e5 count', e5notes.length);
for (const n of e5notes) console.log(' ', pitchWithChord(n), 'chord=', !!n.querySelector('chord'), 'beam=', n.querySelector('beam,*|beam')?.textContent);
const e5Leader = e5notes.find(n => n.querySelector('chord,*|chord') === null);
console.log('e5Leader', e5Leader ? pitchWithChord(e5Leader) : 'NONE');
for (const c of [...m16.children]) {
  if (local(c) !== 'note') continue;
  const ch = c.querySelector('chord,*|chord') ? '*' : '';
  console.log(`${pitch(c)}${ch} v=${c.querySelector('voice,*|voice')?.textContent} type=${c.querySelector('type,*|type')?.textContent} beam=${c.querySelector('beam,*|beam')?.textContent ?? ''}`);
}
