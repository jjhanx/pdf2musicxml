/**
 * Reproduce: m17 play orders 2/2/3/4 → quarters pile at col1, eighths vanish after SVG align.
 * Run: npx tsx _smoke/_repro_m17_po_cluster.ts
 */
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
import { applyPlayOrderLayoutToMeasure } from '../shared/musicXmlPlayOrder';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function noteheadX(sn: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of sn.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    let tx = 0;
    let cur: Element | null = path as Element;
    while (cur) {
      const tr = cur.getAttribute?.('transform') ?? '';
      const tm = /translate\(\s*([-\d.]+)/.exec(tr);
      if (tm) tx += parseFloat(tm[1]!);
      cur = cur.parentElement;
    }
    xs.push(tx + parseFloat(m[1]!));
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

const raw = execSync('python _smoke/_export_m17_play_order_234.py', {
  encoding: 'utf8',
  maxBuffer: 30e6,
});

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
  measure.querySelectorAll('note staff,note *|staff').forEach((el) => {
    el.textContent = '1';
  });
  pruneCrossStaffTimelineForOsmdPreview(measure, 1);
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
  applyPlayOrderLayoutToMeasure(measure);
}
const preview = new XMLSerializer().serializeToString(doc);
const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
console.log('XML default-x after layout:');
for (const c of [...m17.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  const step = c.querySelector('step,*|step')?.textContent;
  const oct = c.querySelector('octave,*|octave')?.textContent;
  const v = c.querySelector('voice,*|voice')?.textContent;
  console.log({
    pitch: `${step}${oct}`,
    v,
    po: c.getAttribute('data-hitl-play-order'),
    x: c.getAttribute('default-x'),
  });
}

async function main() {
  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, preview);
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();

  const before = [...host.querySelectorAll('.vf-stavenote,.vf-staveNote')]
    .map((sn) => noteheadX(sn as SVGGraphicsElement))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  console.log('xs before', before);

  alignOsmdPreviewNotesByOnsetColumn(osmd as never);

  const after = [...host.querySelectorAll('.vf-stavenote,.vf-staveNote')]
    .map((sn) => noteheadX(sn as SVGGraphicsElement))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  console.log('xs after', after);
  console.log('count', after.length, 'min', after[0], 'max', after[after.length - 1]);
}

main();
