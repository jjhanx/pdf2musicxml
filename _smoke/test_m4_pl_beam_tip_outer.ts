/**
 * Verify m4 PL stem tips reach beam OUTER edge after sync (not center).
 * Run: npx tsx _smoke/test_m4_pl_beam_tip_outer.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { createRequire } from 'node:module';
import { filterMusicXmlToMeasureRange } from '../shared/musicXmlMeasureRange.ts';
import {
  repairTimelineForOsmdPreview,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { normalizeMultivoiceStemsForOsmdPreview } from '../shared/musicXmlStem.ts';
import {
  pruneCrossStaffTimelineForOsmdPreview,
  stampHitlSourceNoteIdentity,
} from '../shared/musicXmlStaffPreview.ts';
import { reorderMeasureNotesByPlayOrderForOsmdPreview } from '../shared/musicXmlPlayOrder.ts';
import {
  containOsmdMeasureNotesInAllocatedWidth,
  clipOsmdMeasuresToAllocatedWidth,
} from '../src/osmdMeasureTimingWarning.ts';
import { syncVfStemsAndBeamsAfterStavenoteAlign } from '../src/osmdOnsetColumnAlignFix.ts';

const require = createRequire(import.meta.url);
const OSMD =
  require('opensheetmusicdisplay').OpenSheetMusicDisplay ??
  require('opensheetmusicdisplay').default.OpenSheetMusicDisplay;

const dom = new JSDOM(
  `<!DOCTYPE html><html><body><div id="host" style="width:1400px;height:600px"></div></body></html>`,
  { pretendToBeVisual: true },
);
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
});

function local(el: Element) {
  return (el.localName || el.tagName || '').replace(/^.*:/, '').toLowerCase();
}
function staffN(n: Element) {
  const t = n.querySelector(':scope > staff')?.textContent?.trim();
  return t && /^\d+$/.test(t) ? +t : 1;
}

function toPl(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const sp of [...doc.getElementsByTagName('score-part')]) {
    if (sp.getAttribute('id') !== 'P5') sp.remove();
  }
  for (const p of [...doc.getElementsByTagName('part')]) {
    if (p.getAttribute('id') !== 'P5') p.remove();
  }
  const part = doc.getElementsByTagName('part')[0]!;
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure') continue;
    stampHitlSourceNoteIdentity(measure);
    for (const c of [...measure.children]) {
      if (local(c) === 'note' && staffN(c) !== 2) c.remove();
    }
    pruneCrossStaffTimelineForOsmdPreview(measure, 2);
    for (const attrs of measure.querySelectorAll('attributes')) {
      for (const st of attrs.querySelectorAll('staves')) st.textContent = '1';
      for (const clef of [...attrs.querySelectorAll('clef')]) {
        const num = clef.getAttribute('number');
        const sign = clef.querySelector('sign')?.textContent?.trim();
        if (num === '1' || (sign === 'G' && num !== '2')) clef.remove();
        else clef.removeAttribute('number');
      }
    }
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderMeasureNotesByPlayOrderForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
    measure.querySelectorAll('note staff').forEach((el) => {
      el.textContent = '1';
    });
  }
  return new XMLSerializer().serializeToString(doc);
}

function beamOuterMinAtX(d: string, x: number): number | null {
  const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  const ys = [...d.matchAll(/[MmLl]\s*[-\d.]+\s+([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  if (xs.length < 2) return null;
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const leftYs = ys.filter((_, i) => Math.abs(xs[i]! - left) < 1.5);
  const rightYs = ys.filter((_, i) => Math.abs(xs[i]! - right) < 1.5);
  if (!leftYs.length || !rightYs.length) return null;
  const t = Math.max(0, Math.min(1, (x - left) / (right - left)));
  return Math.min(...leftYs) + t * (Math.min(...rightYs) - Math.min(...leftYs));
}

async function main() {
  assert.ok(fs.existsSync('omr-work-8f913a75.zip'));
  const job = await JSZip.loadAsync(fs.readFileSync('omr-work-8f913a75.zip'));
  const mxl = await JSZip.loadAsync(await job.file('review.mxl')!.async('nodebuffer'));
  const name = Object.keys(mxl.files).find((n) => n.endsWith('.xml') && !n.startsWith('META'))!;
  let xml = await mxl.file(name)!.async('string');
  xml = filterMusicXmlToMeasureRange(xml, 4, 4);
  xml = toPl(xml);
  xml = repairTimelineForOsmdPreview(xml, { faithfulEditorLayout: true });
  xml = normalizeMultivoiceStemsForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml);

  const host = document.getElementById('host')!;
  const osmd = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
  await osmd.load(xml);
  osmd.render();
  containOsmdMeasureNotesInAllocatedWidth(host, osmd);
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  clipOsmdMeasuresToAllocatedWidth(host, osmd);

  const primary = [...host.querySelectorAll('.vf-beam path')]
    .map((p) => {
      const d = p.getAttribute('d') || '';
      const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
      return { d, w: Math.max(...xs) - Math.min(...xs), x0: Math.min(...xs), x1: Math.max(...xs) };
    })
    .filter((b) => b.w > 30)
    .sort((a, b) => a.x0 - b.x0)[0];
  assert.ok(primary, 'primary beam');

  const members = [...host.querySelectorAll('.vf-stem path')]
    .map((p) => {
      const d = (p.getAttribute('d') || '').replace(/\s+/g, ' ').trim();
      const m = /^M\s*([-\d.]+)\s+([-\d.]+)\s*L\s*([-\d.]+)\s+([-\d.]+)/i.exec(d);
      if (!m) return null;
      const x = +m[1]!;
      const tip = Math.min(+m[2]!, +m[4]!);
      const base = Math.max(+m[2]!, +m[4]!);
      if (x < primary.x0 - 3 || x > primary.x1 + 3) return null;
      if (!(tip < base - 5)) return null;
      return { x, tip };
    })
    .filter(Boolean) as { x: number; tip: number }[];

  assert.ok(members.length >= 3, `expected ≥3 stem-up members, got ${members.length}`);
  for (const s of members) {
    const outer = beamOuterMinAtX(primary.d, s.x);
    assert.ok(outer != null);
    const gap = s.tip - outer!;
    assert.ok(
      gap <= 2.5,
      `stem x=${s.x.toFixed(1)} tip=${s.tip.toFixed(1)} outer=${outer!.toFixed(1)} gap=${gap.toFixed(1)} (center snap left ~4–8px gaps)`,
    );
  }
  console.log(
    'test_m4_pl_beam_tip_outer: OK',
    members.map((s) => ({
      x: +s.x.toFixed(1),
      tip: +s.tip.toFixed(1),
      outer: +beamOuterMinAtX(primary.d, s.x)!.toFixed(1),
      gap: +(s.tip - beamOuterMinAtX(primary.d, s.x)!).toFixed(1),
    })),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
