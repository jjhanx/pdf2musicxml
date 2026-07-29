/**
 * m17 play_order2: explicit po column default-x at t=2 + SVG align moves po pitches together.
 * Run: npx tsx _smoke/test_m17_po2_osmd_align.ts
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
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
import { defaultXFromOnset, measureLengthUnits } from '../shared/musicXmlPreviewOnsetLayout';
import { collectStaffNoteOnsets } from '../shared/musicXmlTimelineCleanup';

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
  XMLSerializer: dom.window.XMLSerializer,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildM17Preview(raw: string): { preview: string; osmdLoad: string } {
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
  const preview = new XMLSerializer().serializeToString(doc);
  let osmdLoad = repairMissingNoteTypesForOsmdPreview(repairTimelineForOsmdPreview(preview));
  return { preview, osmdLoad };
}

function noteheadX(sn: SVGGraphicsElement): number | null {
  const bb = sn.getBBox?.();
  if (!bb || bb.width <= 0) return null;
  let tx = 0;
  let cur: Element | null = sn;
  while (cur) {
    const tr = cur.getAttribute?.('transform') ?? '';
    const tm = /translate\(\s*([-\d.]+)/.exec(tr);
    if (tm) tx += parseFloat(tm[1]!);
    cur = cur.parentElement;
  }
  return tx + bb.x + bb.width / 2;
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const { preview, osmdLoad } = buildM17Preview(raw);

  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const m17 = doc.querySelector('part[id="P5"] > measure[number="17"]')!;
  const f4v1 = [...m17.children].find(
    (c) =>
      local(c) === 'note' &&
      c.querySelector('step,*|step')?.textContent === 'F' &&
      c.querySelector('voice,*|voice')?.textContent === '1' &&
      !c.querySelector('chord,*|chord'),
  ) as Element;
  const e5 = [...m17.children].find(
    (c) =>
      local(c) === 'note' &&
      c.querySelector('step,*|step')?.textContent === 'E' &&
      c.querySelector('octave,*|octave')?.textContent === '5' &&
      !c.querySelector('chord,*|chord'),
  ) as Element;
  const f4x = f4v1?.getAttribute('default-x');
  const e5x = e5?.getAttribute('default-x');
  const layoutLen = measureLengthUnits(m17 as Element);
  const onsets = collectStaffNoteOnsets(m17 as Element);
  const e5Onset = e5 ? onsets.get(e5 as Element) : null;
  const wantT2 = defaultXFromOnset(e5Onset ?? 2, layoutLen);
  if (!f4x || f4x !== e5x) throw new Error(`po2 default-x mismatch F4=${f4x} E5=${e5x}`);
  if (Math.abs(parseFloat(f4x) - parseFloat(wantT2)) > 1) {
    throw new Error(`po2 column must match E5 onset x=${wantT2} (onset=${e5Onset} len=${layoutLen}) got ${f4x}`);
  }

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  host.style.height = '400px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, preview);
  await (osmd as { load: (x: string) => Promise<void> }).load(osmdLoad);
  (osmd as { render: () => void }).render();

  const xsBefore = [...host.querySelectorAll('.vf-stavenote,.vf-staveNote')]
    .map((sn) => noteheadX(sn as SVGGraphicsElement))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);

  alignOsmdPreviewNotesByOnsetColumn(osmd as never);

  const xsAfter = [...host.querySelectorAll('.vf-stavenote,.vf-staveNote')]
    .map((sn) => noteheadX(sn as SVGGraphicsElement))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);

  if (xsAfter.length < 3) {
    console.log('skip OSMD DOM (no stavenotes in jsdom); XML layout verified', { defaultX: f4x, e5Onset, layoutLen });
    return;
  }

  // po=2 explicit align: largest cluster at t=2 column should have >=2 noteheads within 2px
  const clusters: number[][] = [];
  for (const x of xsAfter) {
    const c = clusters.find((cl) => Math.abs(cl[0]! - x) < 2);
    if (c) c.push(x);
    else clusters.push([x]);
  }
  const poCluster = clusters.reduce((a, b) => (b.length > a.length ? b : a), clusters[0] ?? []);
  if (poCluster.length < 2) {
    throw new Error(`expected po=2 cluster >=2 noteheads clusters=${JSON.stringify(clusters)}`);
  }
  const poSpread = Math.max(...poCluster) - Math.min(...poCluster);
  if (poSpread > 2) throw new Error(`po cluster spread ${poSpread}`);

  console.log('OK m17 po2 OSMD align', { defaultX: f4x, poClusterSize: poCluster.length, xsAfter: xsAfter.slice(0, 8) });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
