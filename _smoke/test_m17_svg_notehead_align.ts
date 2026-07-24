/**

 * m17 linkParallel: F4·Bb4·E5 notehead X must match after OSMD render + graphic align.

 * Run: npx tsx _smoke/test_m17_svg_notehead_align.ts

 */

import fs from 'node:fs';

import { execSync } from 'node:child_process';

import { JSDOM } from 'jsdom';

import osmdLib from 'opensheetmusicdisplay';

import {

  repairTimelineForOsmdPreview,

  collectLinkedParallelOnsetHintsFromXml,

  snapshotNoteDefaultXForOsmdPreview,

  reorderSingleStaffTimelineByOnsetForOsmdPreview,

  normalizeMultiVoiceLayersForOsmdPreview,

  realignMeasureDefaultXFromTimelineForOsmd,

} from '../shared/musicXmlTimelineCleanup';

import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

import {

  alignLinkedParallelOnsetGraphics,

  applyLinkedParallelVoiceSpacingForOsmdPreview,

} from '../src/osmdLinkedParallelAlignFix';



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

  SVGElement: dom.window.SVGElement,

  requestAnimationFrame: (cb: FrameRequestCallback) => {

    setTimeout(() => cb(0), 0);

    return 0;

  },

});

if (!dom.window.SVGSVGElement.prototype.createSVGPoint) {
  dom.window.SVGSVGElement.prototype.createSVGPoint = function () {
    const pt = { x: 0, y: 0 };
    return {
      ...pt,
      matrixTransform(m: DOMMatrix) {
        return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
      },
    };
  } as typeof dom.window.SVGSVGElement.prototype.createSVGPoint;
}

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();



function buildM17Slice(raw: string): string {

  let xml = repairTimelineForOsmdPreview(raw);

  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const part = [...doc.getElementsByTagName('part')].find((p) => p.getAttribute('id') === 'P5')!;

  for (const measure of [...part.children]) {

    if (local(measure) !== 'measure') continue;

    for (const child of [...measure.children]) {

      if (local(child) === 'note') {

        const st = child.querySelector('staff')?.textContent?.trim();

        if (st && st !== '1') child.remove();

      }

    }

    [...measure.querySelectorAll('note staff')].forEach((el) => {

      el.textContent = '1';

    });

    pruneCrossStaffTimelineForOsmdPreview(measure, 1);

    snapshotNoteDefaultXForOsmdPreview(measure);

    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);

    normalizeMultiVoiceLayersForOsmdPreview(measure);

    realignMeasureDefaultXFromTimelineForOsmd(measure);

  }

  const m17 = [...part.children].find(

    (c) => local(c) === 'measure' && c.getAttribute('number') === '17',

  )!;

  return repairTimelineForOsmdPreview(

    `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name>PR</part-name></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`,

  );

}



function noteheadCenterX(stavenote: SVGGraphicsElement): number | null {

  const svg = stavenote.ownerSVGElement;

  if (!svg) return null;

  const xs: number[] = [];

  for (const path of stavenote.querySelectorAll('.vf-notehead path')) {

    const d = path.getAttribute('d');

    if (!d) continue;

    const m = /^M\s*([-\d.]+)/.exec(d.trim());

    if (!m) continue;

    const pt = svg.createSVGPoint();

    pt.x = parseFloat(m[1]!);

    pt.y = 0;

    const ctm = (path as SVGGraphicsElement).getCTM?.();

    if (ctm) xs.push(pt.matrixTransform(ctm).x);

  }

  if (!xs.length) return null;

  return xs.reduce((a, b) => a + b, 0) / xs.length;

}



async function main() {

  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });

  const slice = buildM17Slice(raw);

  const hints = collectLinkedParallelOnsetHintsFromXml(slice).filter((h) => h.measureNumber === 17);

  if (!hints.length) throw new Error('no m17 linked parallel hints');



  const host = document.getElementById('host')!;

  host.style.width = '900px';

  host.style.height = '400px';



  async function run(label: string, zeroVoiceSpacing: boolean) {

    host.innerHTML = '';

    const osmd = new OSMD!(host, { autoResize: false, backend: 'svg', drawMeasureNumbers: false });

    const rules = (osmd as { EngravingRules: Record<string, unknown> }).EngravingRules;

    if (zeroVoiceSpacing) applyLinkedParallelVoiceSpacingForOsmdPreview(rules as never, hints.length);

    await (osmd as { load: (x: string) => Promise<void> }).load(slice);

    if (zeroVoiceSpacing) applyLinkedParallelVoiceSpacingForOsmdPreview(rules as never, hints.length);

    (osmd as { render: () => void }).render();

    alignLinkedParallelOnsetGraphics(osmd as never, hints, host);



    const xs = [...host.querySelectorAll('.vf-stavenote')]

      .map((sn) => noteheadCenterX(sn as SVGGraphicsElement))

      .filter((x): x is number => x != null)

      .sort((a, b) => a - b);

    if (xs.length < 3) throw new Error(`${label}: expected >=3 stavenotes, got ${xs.length}`);



    const parallelXs = xs.slice(1, 3);

    const spread = Math.abs(parallelXs[1]! - parallelXs[0]!);

    console.log(label, { xs, spread, mult: rules.VoiceSpacingMultiplierVexflow, add: rules.VoiceSpacingAddendVexflow });

    if (spread > 0.5) throw new Error(`${label}: parallel noteheads misaligned spread=${spread}`);

    return spread;

  }



  await run('default+align', false);

  await run('vspace0+align', true);

  console.log('OK m17 svg notehead align');

}



main().catch((e) => {

  console.error('FAIL', e);

  process.exit(1);

});


