/**
 * m16 PR: mergeSameOnsetVoices must NOT chord-merge beamed eighths (E5/F5).
 * Run: npx tsx _smoke/test_m16_voice_merge_guard.ts
 */
import fs from 'node:fs';
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
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function transformMeasure(measure: Element): void {
  for (const child of [...measure.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff, *|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
    el.textContent = '1';
  });
  pruneCrossStaffTimelineForOsmdPreview(measure, 1);
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  mergeSameOnsetVoicesForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
}

function pitch(n: Element): string {
  const step = n.querySelector('step, *|step')?.textContent ?? '?';
  const oct = n.querySelector('octave, *|octave')?.textContent ?? '?';
  const alter = n.querySelector('alter, *|alter')?.textContent ?? '';
  const acc = alter === '-1' ? 'b' : '';
  const ch = n.querySelector('chord, *|chord') ? '*' : '';
  return `${step}${acc}${oct}${ch}`;
}

async function main() {
  const zip = 'omr-work-0ea5ea52.zip';
  if (!fs.existsSync(zip)) {
    console.log('skip');
    return;
  }
  const { execSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const out = join(tmpdir(), '0ea5_review.xml');
  execSync(`python -c "import io,zipfile;z=zipfile.ZipFile('${zip}');d=z.read('review.mxl');inner=zipfile.ZipFile(io.BytesIO(d));x=[n for n in inner.namelist() if n.endswith('.xml') and 'META' not in n.upper()][0];open(r'${out.replace(/\\/g, '\\\\')}', 'wb').write(inner.read(x))"`, {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  const raw = readFileSync(out, 'utf8');
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m16 = [...part.children].find(
    (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '16',
  ) as Element;
  transformMeasure(m16);

  const e5notes = [...m16.children]
    .filter((c) => local(c) === 'note')
    .map((n) => n as Element)
    .filter((n) => pitch(n).startsWith('E5'));

  const e5Leader = e5notes.find((n) => n.querySelector('chord, *|chord') === null);
  if (!e5Leader || e5Leader.querySelector('beam, *|beam')?.textContent !== 'begin') {
    throw new Error('parallel F4·E5 group: first E5 must stay non-chord beam leader');
  }
  const f4Voice2 = [...m16.children]
    .filter((c) => local(c) === 'note')
    .map((n) => n as Element)
    .find((n) => pitch(n) === 'F4' && n.querySelector('voice, *|voice')?.textContent === '2');
  if (!f4Voice2) throw new Error('F4 voice 2 must remain separate from parallel E5');

  for (const n of e5notes) {
    const typ = n.querySelector('type, *|type')?.textContent;
    const beam = n.querySelector('beam, *|beam')?.textContent;
    if (typ !== 'eighth') throw new Error(`E5 must stay eighth, got type=${typ}`);
    if (!beam) throw new Error('E5 beam tag missing');
  }

  const f5 = [...m16.children]
    .filter((c) => local(c) === 'note')
    .map((n) => n as Element)
    .find((n) => pitch(n) === 'F5');
  if (f5?.querySelector('type,*|type')?.textContent !== 'eighth') throw new Error('F5 not eighth');
  if (f5?.querySelector('beam,*|beam')?.textContent !== 'end') throw new Error('F5 beam end missing');

  console.log('m16 voice merge guard ok', e5notes.length, 'E5 eighths preserved');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
