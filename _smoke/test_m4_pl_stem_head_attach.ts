/**
 * After HITL sync, orphan stem bases must stay on their notehead pitch Y,
 * and stem dx must match the paired stavenote (id match) — not a same-onset other voice.
 * Run: npx tsx _smoke/test_m4_pl_stem_head_attach.ts
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
import {
  syncVfStemsAndBeamsAfterStavenoteAlign,
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix.ts';

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

function readDx(el: Element) {
  const tr = el.getAttribute('transform') || '';
  const m = /translate\(\s*([-\d.]+)/.exec(tr);
  return m ? parseFloat(m[1]!) : 0;
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
  registerOsmdPreviewXmlForAlign(osmd, xml);
  await osmd.load(xml);
  osmd.render();
  alignOsmdPreviewNotesByOnsetColumn(osmd);
  // Simulate contain shifting first beamed note while leaving a same-x inner-stem note
  const g = host.querySelector('g.vf-measure')!;
  const firstOrphan = g.querySelector(':scope > .vf-stem') as Element;
  assert.ok(firstOrphan, 'expected orphan stem');
  const noteId = firstOrphan.id.replace(/-stem\d*$/, '');
  const sn = [...g.querySelectorAll(':scope > .vf-stavenote')].find((n) => n.id === noteId)!;
  assert.ok(sn, `stavenote ${noteId}`);
  // Force a dx mismatch scenario: move note, leave stem, then sync must reattach by id
  const before = readDx(sn);
  sn.setAttribute('transform', `translate(${before - 12}, 0)`);
  // Also yank stem base away from pitch to simulate bad tip snap
  const path = firstOrphan.querySelector('path')!;
  const d0 = path.getAttribute('d')!;
  const m = /^M\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*L\s*([-\d.eE+]+)\s+([-\d.eE+]+)/i.exec(d0.trim())!;
  const y1 = +m[2]!,
    y2 = +m[4]!;
  const tip = Math.min(y1, y2);
  const base = Math.max(y1, y2);
  // Move base toward tip by 8px (detach from head)
  const badBase = base - 8;
  if (y1 >= y2) path.setAttribute('d', `M${m[1]} ${badBase}L${m[3]} ${y2}`);
  else path.setAttribute('d', `M${m[1]} ${y1}L${m[3]} ${badBase}`);

  containOsmdMeasureNotesInAllocatedWidth(host, osmd);
  clipOsmdMeasuresToAllocatedWidth(host, osmd);
  // contain already syncs; force again
  syncVfStemsAndBeamsAfterStavenoteAlign(host);

  const stemDx = readDx(firstOrphan);
  const noteDx = readDx(sn);
  assert.ok(
    Math.abs(stemDx - noteDx) < 0.05,
    `stem dx ${stemDx} must match note dx ${noteDx}`,
  );

  const hd = sn.querySelector('.vf-notehead path')!.getAttribute('d')!;
  const pitchY = +/M\s*[-\d.]+\s+([-\d.]+)/.exec(hd)![1]!;
  const d1 = firstOrphan.querySelector('path')!.getAttribute('d')!;
  const m1 = /^M\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*L\s*([-\d.eE+]+)\s+([-\d.eE+]+)/i.exec(d1.trim())!;
  const baseAfter = Math.max(+m1[2]!, +m1[4]!);
  const tipAfter = Math.min(+m1[2]!, +m1[4]!);
  assert.ok(
    Math.abs(baseAfter - pitchY) < 0.6,
    `stem base ${baseAfter} must meet pitchY ${pitchY}`,
  );
  assert.ok(tipAfter < baseAfter - 10, 'stem must remain long enough to reach beam');

  // 고아 stem dx 이동 후에도 1차 빔이 첫 줄기를 포함해야 함(끊김 회귀 방지)
  const stemX = +m1[1]! + stemDx;
  const beams = [...g.querySelectorAll(':scope > .vf-beam path')].map((p) => {
    const d = p.getAttribute('d') || '';
    const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((mm) => +mm[1]!);
    return { left: Math.min(...xs), right: Math.max(...xs), w: Math.max(...xs) - Math.min(...xs) };
  });
  beams.sort((a, b) => b.w - a.w);
  const primary = beams[0]!;
  assert.ok(
    stemX >= primary.left - 4 && stemX <= primary.right + 4,
    `primary beam [${primary.left},${primary.right}] must cover first stem x=${stemX}`,
  );
  assert.ok(
    Math.abs(stemX - primary.left) <= 6,
    `primary beam left ${primary.left} must meet first stem ${stemX}`,
  );

  console.log('test_m4_pl_stem_head_attach: OK', {
    noteId,
    noteDx,
    stemDx,
    pitchY,
    baseAfter,
    tipAfter,
    beamLeft: primary.left,
    stemX,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
