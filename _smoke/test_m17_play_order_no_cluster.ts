/**
 * m17 play orders 2/3/4 — SVG align must not pile quarters at col1 or vanish eighths.
 * Run: npx tsx _smoke/test_m17_play_order_no_cluster.ts
 */
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
import { applyPlayOrderLayoutToMeasure } from '../shared/musicXmlPlayOrder';
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
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

function buildPreview(raw: string): string {
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
  const serialized = new XMLSerializer().serializeToString(doc);
  return repairMissingNoteTypesForOsmdPreview(
    repairTimelineForOsmdPreview(`<?xml version="1.0" encoding="UTF-8"?>${serialized}`),
  );
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_play_order_234.py', {
    encoding: 'utf8',
    maxBuffer: 30e6,
  });
  const preview = buildPreview(raw);
  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  const byPo = new Map<string, string[]>();
  for (const c of [...m17.children]) {
    if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
    const po = c.getAttribute('data-hitl-play-order') ?? 'auto';
    const x = c.getAttribute('default-x') ?? '?';
    const list = byPo.get(po) ?? [];
    list.push(x);
    byPo.set(po, list);
  }
  // XML: po2 and po4 must not share the first-column x (32)
  const po2x = byPo.get('2')?.[0];
  const po4x = byPo.get('4')?.[0];
  const po3x = byPo.get('3')?.[0];
  if (!po2x || !po3x || !po4x) throw new Error(`missing po columns ${JSON.stringify([...byPo])}`);
  if (po2x === '32.00' || po4x === '32.00') {
    throw new Error(`po2/po4 must not sit at col1 got po2=${po2x} po4=${po4x}`);
  }
  if (po2x === po4x) throw new Error(`po2 and po4 must differ got ${po2x}`);
  if (po2x === po3x) throw new Error(`po2 and po3 must differ got ${po2x}`);

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, preview);
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();

  const before = [...host.querySelectorAll('.vf-stavenote,.vf-staveNote')]
    .map((sn) => noteheadX(sn as SVGGraphicsElement))
    .filter((x): x is number => x != null);
  alignOsmdPreviewNotesByOnsetColumn(osmd as never);
  const after = [...host.querySelectorAll('.vf-stavenote,.vf-staveNote')]
    .map((sn) => noteheadX(sn as SVGGraphicsElement))
    .filter((x): x is number => x != null);

  if (after.length < 4) throw new Error(`eighths vanished: stavenotes ${after.length}`);
  if (before.length > 0 && after.length < before.length) {
    throw new Error(`noteheads vanished after align ${before.length}→${after.length}`);
  }

  // After align: unique x clusters should remain (>=3). Piling all at one x = bug.
  const clusters: number[][] = [];
  for (const x of [...after].sort((a, b) => a - b)) {
    const c = clusters.find((cl) => Math.abs(cl[0]! - x) < 8);
    if (c) c.push(x);
    else clusters.push([x]);
  }
  if (clusters.length < 3) {
    throw new Error(`expected >=3 x columns after align, got ${JSON.stringify(clusters)}`);
  }
  const biggest = Math.max(...clusters.map((c) => c.length));
  if (biggest >= after.length - 1) {
    throw new Error(`notes piled into one column clusters=${JSON.stringify(clusters)}`);
  }

  console.log('OK m17 play-order no cluster', {
    po2x,
    po3x,
    po4x,
    clusters: clusters.length,
    staves: after.length,
  });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
