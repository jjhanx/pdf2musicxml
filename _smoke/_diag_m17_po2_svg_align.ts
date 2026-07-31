/** OSMD SVG x after align — po=2 F4/Bb4/E5 must share column */
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
  collectPreviewNoteLayoutTargetsFromXml,
  HITL_PLAY_ORDER_ATTR,
} from '../shared/musicXmlPlayOrder';
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
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const s = n.querySelector('step,*|step')?.textContent ?? '';
  const o = n.querySelector('octave,*|octave')?.textContent ?? '';
  const a = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${s}${a === '-1' ? 'b' : ''}${o}`;
};

function buildPreview(raw: string): string {
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
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  snapshotNoteDefaultXForOsmdPreview(m17);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  normalizeMultiVoiceLayersForOsmdPreview(m17);
  realignMeasureDefaultXFromTimelineForOsmd(m17);
  return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
}

function noteheadX(sn: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of sn.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    const m = d && /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const ctm = (path as SVGGraphicsElement).getCTM?.();
    if (ctm) xs.push(ctm.a * parseFloat(m[1]!) + ctm.e);
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) { console.log('skip'); return; }
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const preview = buildPreview(raw);
  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const m17 = doc.querySelector('measure[number="17"]')!;
  console.log('XML po=2:');
  for (const ch of [...m17.children]) {
    if (local(ch) !== 'note') continue;
    const po = (ch as Element).getAttribute(HITL_PLAY_ORDER_ATTR);
    if (po !== '2') continue;
    console.log(' ', pitch(ch as Element), 'x=' + (ch as Element).getAttribute('default-x'));
  }
  console.log('targets po2:', collectPreviewNoteLayoutTargetsFromXml(preview).filter((t) => t.defaultXTenths === 32));

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, preview);
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();

  const before: Record<string, number> = {};
  for (const sn of host.querySelectorAll('.vf-stavenote,.vf-staveNote')) {
    const x = noteheadX(sn as SVGGraphicsElement);
    if (x == null) continue;
    const y = Math.round((sn as SVGGraphicsElement).getBBox?.().y ?? 0);
    before[`y${y}`] = x;
  }
  console.log('SVG before align (by y):', before);

  alignOsmdPreviewNotesByOnsetColumn(osmd as never, preview);

  const after: number[] = [];
  for (const sn of host.querySelectorAll('.vf-stavenote,.vf-staveNote')) {
    const x = noteheadX(sn as SVGGraphicsElement);
    if (x != null) after.push(x);
  }
  after.sort((a, b) => a - b);
  console.log('SVG after align xs:', after.slice(0, 8));
  const po2xs = after.slice(0, 3);
  if (po2xs.length >= 2 && Math.max(...po2xs) - Math.min(...po2xs) > 3) {
    throw new Error(`po2 column misaligned spread=${Math.max(...po2xs) - Math.min(...po2xs)}`);
  }
  console.log('OK po2 column aligned');
}

main().catch((e) => { console.error(e); process.exit(1); });
