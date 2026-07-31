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
import { dedupeSamePlayOrderPitchLayersForOsmdPreview, collectPlayOrderAlignGroupsFromXml } from '../shared/musicXmlPlayOrder';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });

const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
let xml = repairTimelineForOsmdPreview(raw);
const doc = new DOMParser().parseFromString(xml, 'text/xml');
const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
const m17 = [...part.children].find((c) => c.getAttribute('number') === '17') as Element;
for (const child of [...m17.children]) {
  if (child.localName === 'note') {
    const st = child.querySelector('staff,*|staff')?.textContent?.trim();
    if (st && st !== '1') child.remove();
  }
}
m17.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
pruneCrossStaffTimelineForOsmdPreview(m17, 1);
snapshotNoteDefaultXForOsmdPreview(m17);
reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
normalizeMultiVoiceLayersForOsmdPreview(m17);
dedupeSamePlayOrderPitchLayersForOsmdPreview(m17);
realignMeasureDefaultXFromTimelineForOsmd(m17);
const preview = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
console.log(JSON.stringify(collectPlayOrderAlignGroupsFromXml(preview), null, 2));
for (const n of [...m17.children]) {
  if (n.localName !== 'note') continue;
  const step = n.querySelector('step,*|step')?.textContent;
  const po = n.getAttribute('data-hitl-play-order');
  const dx = n.getAttribute('default-x');
  const typ = n.querySelector('type,*|type')?.textContent;
  if (step === 'F' || step === 'E') console.log(step, typ, 'po', po, 'dx', dx, n.querySelector('chord') ? 'chord' : 'leader');
}
