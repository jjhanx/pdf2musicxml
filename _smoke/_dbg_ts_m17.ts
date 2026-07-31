import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  collectLinkedParallelOnsetHintsFromXml,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { osmdTimestampFromLinkedParallelHint } from '../src/osmdOnsetColumnAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from '../src/osmdMeasureClick';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
let xml = repairTimelineForOsmdPreview(raw);
const doc = new DOMParser().parseFromString(xml, 'text/xml');
const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
for (const measure of [...part.children]) {
  if (local(measure) !== 'measure') continue;
  for (const child of [...measure.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff,*|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  [...measure.querySelectorAll('note staff,note *|staff')].forEach((el) => { el.textContent = '1'; });
  pruneCrossStaffTimelineForOsmdPreview(measure, 1);
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
}
const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
const slice =
  '<?xml version="1.0"?><score-partwise><part-list><score-part id="P5"><part-name/></score-part></part-list>' +
  `<part id="P5">${m17.outerHTML}</part></score-partwise>`;

const hints = collectLinkedParallelOnsetHintsFromXml(slice);
console.log('hint ts', hints.map((h) => osmdTimestampFromLinkedParallelHint(h)));

async function main() {
  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  await (osmd as { load: (x: string) => Promise<void> }).load(slice);
  (osmd as { render: () => void }).render();

  forEachGraphicalMeasure(osmd as never, (gm) => {
    if (measureMxlFromGraphic(gm) !== 17) return;
    const g = gm as Record<string, unknown>;
    for (const se of (g.staffEntries ?? g.StaffEntries ?? []) as Record<string, unknown>[]) {
      for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
        const pve = gve.parentVoiceEntry ?? gve.ParentVoiceEntry;
        const pver = pve as Record<string, unknown>;
        const ts = (pver?.timestamp as Record<string, unknown>)?.realValue ?? pver?.timestamp;
        for (const gn of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
          const vf = Array.isArray(gn.vfpitch) ? gn.vfpitch[0] : gn.vfpitch;
          console.log(String(vf), 'ts=', ts);
        }
      }
    }
  });
}

main();
