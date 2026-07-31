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
import {
  dedupeSamePlayOrderPitchLayersForOsmdPreview,
  collectPlayOrderAlignGroupsFromXml,
} from '../shared/musicXmlPlayOrder';
import { alignOsmdPreviewNotesByOnsetColumn, registerOsmdPreviewXmlForAlign } from '../src/osmdOnsetColumnAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic, partIdFromGraphic } from '../src/osmdMeasureClick';

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

function noteheadCenterX(stavenote: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of stavenote.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const localX = parseFloat(m[1]!);
    const pathEl = path as SVGGraphicsElement;
    const ctm = pathEl.getCTM?.();
    if (ctm) xs.push(ctm.a * localX + ctm.e);
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

async function main() {
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
  const groups = collectPlayOrderAlignGroupsFromXml(preview);
  console.log('groups', groups);

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  host.style.height = '400px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, preview);
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();

  forEachGraphicalMeasure(osmd as never, (gm) => {
    console.log('gm mxl', measureMxlFromGraphic(gm), 'part', partIdFromGraphic(gm));
  });

  const before = [...host.querySelectorAll('.vf-stavenote,.vf-staveNote')].map((sn) => noteheadCenterX(sn as SVGGraphicsElement));
  console.log('before', before);
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, preview);
  const after = [...host.querySelectorAll('.vf-stavenote,.vf-staveNote')].map((sn) => noteheadCenterX(sn as SVGGraphicsElement));
  console.log('after', after);
}

main();
