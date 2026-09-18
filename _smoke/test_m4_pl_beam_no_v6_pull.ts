/**
 * m4 PL: same-onset v6 stem must not pull the stem-up beam left (looks like quarters).
 * m9 S same rhythm has no parallel voice — control that sync still keeps beams.
 * Run: npx tsx _smoke/test_m4_pl_beam_no_v6_pull.ts
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
} from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { syncVfStemsAndBeamsAfterStavenoteAlign } from '../src/osmdOnsetColumnAlignFix.ts';
import {
  containOsmdMeasureNotesInAllocatedWidth,
  clipOsmdMeasuresToAllocatedWidth,
} from '../src/osmdMeasureTimingWarning.ts';

const require = createRequire(import.meta.url);
const OSMD =
  require('opensheetmusicdisplay').OpenSheetMusicDisplay ??
  require('opensheetmusicdisplay').default.OpenSheetMusicDisplay;

const dom = new JSDOM(
  `<!DOCTYPE html><html><body><div id="host" style="width:1600px;height:900px"></div></body></html>`,
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

function withXmlDecl(xml: string): string {
  return `<?xml version="1.0"?>\n${xml.replace(/^<\?xml[^>]*\?>\s*/i, '')}`;
}

function keepParts(xml: string, ids: string[]): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const sp of [...doc.getElementsByTagName('score-part')]) {
    if (!ids.includes(sp.getAttribute('id') || '')) sp.remove();
  }
  for (const p of [...doc.getElementsByTagName('part')]) {
    if (!ids.includes(p.getAttribute('id') || '')) p.remove();
  }
  return withXmlDecl(new XMLSerializer().serializeToString(doc));
}

function plFirstBeamedGroup(host: Element): { x0: number; x1: number; w: number } | null {
  // First stem-up primary on bass staff: leftmost wide beam that sits on stem-up tips
  let best: { x0: number; x1: number; w: number } | null = null;
  for (const g of host.querySelectorAll('g.vf-measure')) {
    for (const p of g.querySelectorAll('.vf-beam path')) {
      const d = p.getAttribute('d') || '';
      const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
      const ys = [...d.matchAll(/[MmLl]\s*[-\d.]+\s+([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
      if (xs.length < 2) continue;
      const w = Math.max(...xs) - Math.min(...xs);
      if (w < 30) continue;
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const yMid = (Math.min(...ys) + Math.max(...ys)) / 2;
      // stem-up members: tip above notehead (tip < base) and tip near beam
      const upMembers = [...g.querySelectorAll('.vf-stem path')].filter((sp) => {
        const sd = sp.getAttribute('d') || '';
        const m = /^M\s*([-\d.]+)\s+([-\d.]+)\s*L\s*([-\d.]+)\s+([-\d.]+)/i.exec(
          sd.replace(/\s+/g, ' ').trim(),
        );
        if (!m) return false;
        const x = +m[1]!;
        const tip = Math.min(+m[2]!, +m[4]!);
        const base = Math.max(+m[2]!, +m[4]!);
        if (x < x0 - 2 || x > x1 + 2) return false;
        if (!(tip < base - 5)) return false; // stem-up
        return Math.abs(tip - yMid) < 50;
      });
      if (upMembers.length < 2) continue;
      if (!best || x0 < best.x0) best = { x0: +x0.toFixed(2), x1: +x1.toFixed(2), w: +w.toFixed(2) };
    }
  }
  return best;
}

async function main() {
  const zipPath = 'omr-work-8f913a75.zip';
  assert.ok(fs.existsSync(zipPath), `need ${zipPath}`);
  const job = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const mxl = await JSZip.loadAsync(await job.file('review.mxl')!.async('nodebuffer'));
  const name = Object.keys(mxl.files).find((n) => n.endsWith('.xml') && !n.startsWith('META'))!;
  let xml = await mxl.file(name)!.async('string');
  xml = repairTimelineForOsmdPreview(xml, { faithfulEditorLayout: true });
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml);

  const host = document.getElementById('host')!;
  const m4 = keepParts(filterMusicXmlToMeasureRange(xml, 4, 4), ['P5']);
  const osmd = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
  await osmd.load(m4);
  osmd.render();

  const before = plFirstBeamedGroup(host);
  assert.ok(before, 'expected PL first beamed group before sync');
  console.log('before', before);

  containOsmdMeasureNotesInAllocatedWidth(host, osmd);
  clipOsmdMeasuresToAllocatedWidth(host, osmd);

  const after = plFirstBeamedGroup(host);
  assert.ok(after, 'expected PL first beamed group after contain/clip/sync');
  console.log('after', after);

  // Must not jump ~10px left onto parallel v6 stem (D2 under D3)
  assert.ok(
    Math.abs(after!.x0 - before!.x0) < 4,
    `sync must not pull PL beam left onto v6 stem: before=${before!.x0} after=${after!.x0}`,
  );
  // First group should stay near D3 stem (~163 in piano-only layout), not D2 (~153)
  assert.ok(after!.x0 > 158, `beam left should stay on D3 stem side, got ${after!.x0}`);

  // Control: m9 S still has a primary beam after sync
  host.innerHTML = '';
  const osmd9 = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
  await osmd9.load(keepParts(filterMusicXmlToMeasureRange(xml, 9, 9), ['P1']));
  osmd9.render();
  const sBefore = [...host.querySelectorAll('.vf-beam path')].length;
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  const sAfter = [...host.querySelectorAll('.vf-beam path')].length;
  assert.ok(sBefore >= 2 && sAfter >= 2, `m9 S beams intact ${sBefore}→${sAfter}`);

  console.log('test_m4_pl_beam_no_v6_pull: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
