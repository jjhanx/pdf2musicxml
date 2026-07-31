import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { dedupeSamePlayOrderPitchLayersForOsmdPreview } from '../shared/musicXmlPlayOrder';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

function pitch(n: Element) {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent?.trim();
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
}

function dumpM17(m17: Element, label: string) {
  const parts: string[] = [];
  for (const c of [...m17.children]) {
    const tag = c.localName?.toLowerCase() ?? c.tagName;
    if (tag === 'note') {
      parts.push(`${pitch(c)}${c.querySelector('chord,*|chord') ? '*' : ''}`);
    } else if (tag === 'forward' || tag === 'backup') {
      parts.push(`<${tag}>`);
    }
  }
  console.log(label, parts.join(' '));
}

function transformM17(m17: Element) {
  for (const child of [...m17.children]) {
    if (child.localName === 'note') {
      const st = child.querySelector('staff,*|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  m17.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
  dumpM17(m17, 'after staff filter');
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  snapshotNoteDefaultXForOsmdPreview(m17);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  dumpM17(m17, 'after reorder');
  normalizeMultiVoiceLayersForOsmdPreview(m17);
  dumpM17(m17, 'after layer norm');
  dedupeSamePlayOrderPitchLayersForOsmdPreview(m17);
  dumpM17(m17, 'after dedupe');
  realignMeasureDefaultXFromTimelineForOsmd(m17);
  dumpM17(m17, 'after layout');
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => c.getAttribute('number') === '17') as Element;
  transformM17(m17);
  const preview = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
  fs.writeFileSync('_smoke/_m17_pr_vanish.xml', preview);

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  host.style.height = '500px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();
  console.log('stavenotes', host.querySelectorAll('.vf-stavenote,.vf-staveNote').length);
}

main().catch(console.error);
