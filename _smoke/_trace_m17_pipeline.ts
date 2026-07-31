/** Trace m17 XML through each preview step — onset + document order */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
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
const pitch = (n: Element) => {
  const s = n.querySelector('step,*|step')?.textContent ?? '?';
  const o = n.querySelector('octave,*|octave')?.textContent ?? '';
  const a = n.querySelector('alter,*|alter')?.textContent;
  const acc = a === '-1' ? 'b' : a === '1' ? '#' : '';
  return `${s}${acc}${o}`;
};

function dumpTimeline(label: string, measure: Element): void {
  console.log(`\n=== ${label} ===`);
  const vc = new Map<string, number>();
  let lastV = '1';
  for (const ch of [...measure.children]) {
    const tag = local(ch);
    if (tag === 'backup') {
      const d = parseInt(ch.querySelector('duration,*|duration')?.textContent ?? '0', 10);
      console.log(`  backup d=${d} (cursor v1=${vc.get('1') ?? 0})`);
      for (const [v, t] of vc) vc.set(v, Math.max(0, t - d));
    } else if (tag === 'forward') {
      const v = ch.querySelector('voice,*|voice')?.textContent?.trim() || lastV;
      const d = parseInt(ch.querySelector('duration,*|duration')?.textContent ?? '0', 10);
      vc.set(v, (vc.get(v) ?? 0) + d);
      console.log(`  forward v=${v} d=${d} → cursor=${vc.get(v)}`);
    } else if (tag === 'note') {
      const chord = ch.querySelector('chord,*|chord') !== null;
      const v = ch.querySelector('voice,*|voice')?.textContent?.trim() || '1';
      lastV = v;
      const t = vc.get(v) ?? 0;
      const dur = ch.querySelector('duration,*|duration')?.textContent ?? '?';
      const x = ch.getAttribute('default-x') ?? '-';
      const po = ch.getAttribute('data-hitl-play-order') ?? '-';
      const mark = chord ? '  +chord' : '';
      if (!chord) {
        console.log(`  ${pitch(ch).padEnd(4)} v=${v} t=${t} dur=${dur} x=${x} po=${po}${mark}`);
        vc.set(v, t + parseInt(String(dur), 10));
      } else {
        console.log(`  ${pitch(ch).padEnd(4)} v=${v} t=${t} (chord) x=${x}${mark}`);
      }
    }
  }
}

const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
let xml = repairTimelineForOsmdPreview(raw);
const doc = new DOMParser().parseFromString(xml, 'text/xml');
const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17') as Element;
for (const child of [...m17.children]) {
  if (local(child) === 'note') {
    const st = child.querySelector('staff,*|staff')?.textContent?.trim();
    if (st && st !== '1') child.remove();
  }
}
m17.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });

dumpTimeline('raw after repair (staff1 only)', m17);
pruneCrossStaffTimelineForOsmdPreview(m17, 1);
dumpTimeline('after pruneCrossStaff', m17);
snapshotNoteDefaultXForOsmdPreview(m17);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
dumpTimeline('after reorder', m17);
normalizeMultiVoiceLayersForOsmdPreview(m17);
dumpTimeline('after normalizeMultiVoiceLayers', m17);
realignMeasureDefaultXFromTimelineForOsmd(m17);
dumpTimeline('after realign (with default-x)', m17);

const stripped = repairTimelineForOsmdPreview(new XMLSerializer().serializeToString(doc));
const doc2 = new DOMParser().parseFromString(stripped, 'text/xml');
const m17s = [...doc2.querySelectorAll('part,*|part')][0]!.children[0] as Element;
console.log('\n=== after stripDefaultXy (what OSMD loads) ===');
for (const ch of [...m17s.children]) {
  const tag = local(ch);
  if (tag === 'note' && !ch.querySelector('chord,*|chord')) {
    console.log(`  ${pitch(ch)} v=${ch.querySelector('voice,*|voice')?.textContent} default-x=${ch.getAttribute('default-x') ?? 'NONE'}`);
  } else if (tag === 'forward' || tag === 'backup') {
    console.log(`  ${tag} d=${ch.querySelector('duration,*|duration')?.textContent}`);
  }
}
