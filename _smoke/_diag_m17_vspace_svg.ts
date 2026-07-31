/** Compare SVG output: default vs VoiceSpacing=0 on m17 slice */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  Node: dom.window.Node, Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});
const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildM17Slice(raw: string): string {
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
    measure.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
}

function extractTransforms(svgHtml: string): string[] {
  const re = /translate\([^)]+\)/g;
  return [...svgHtml.matchAll(re)].map((m) => m[0]).slice(0, 30);
}

async function render(label: string, zeroVoiceSpacing: boolean) {
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const slice = buildM17Slice(raw);
  const host = document.getElementById('h')!;
  host.innerHTML = '';
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  const rules = (osmd as { EngravingRules: Record<string, unknown> }).EngravingRules;
  if (zeroVoiceSpacing) {
    rules.VoiceSpacingMultiplierVexflow = 0;
    rules.VoiceSpacingAddendVexflow = 0;
  }
  await (osmd as { load: (x: string) => Promise<void> }).load(slice);
  (osmd as { render: () => void }).render();
  const html = host.innerHTML;
  fs.writeFileSync(`_smoke/_m17_svg_${label}.html`, html);
  const transforms = extractTransforms(html);
  console.log(`\n${label} mult=${rules.VoiceSpacingMultiplierVexflow} add=${rules.VoiceSpacingAddendVexflow}`);
  console.log('transforms sample', transforms.slice(0, 15));
  const uniq = [...new Set(transforms.map((t) => t.replace(/translate\(\s*([-\d.]+).*/, '$1')))];
  console.log('unique translate X (first number)', uniq.slice(0, 12));
}

async function main() {
  await render('default', false);
  await render('vspace0', true);
}

main().catch(console.error);
