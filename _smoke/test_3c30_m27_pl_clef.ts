/**
 * omr-work-3c30ccde m27 PL: mid G before backup must get OSMD vfClefBefore after preview transform.
 * Run: npx tsx _smoke/test_3c30_m27_pl_clef.ts
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import {
  normalizeMultiVoiceLayersForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { anchorTrailingMidClefsInMeasure } from '../shared/musicXmlMidClefOsmdAnchor';

const require = createRequire(import.meta.url);
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h" style="width:1100px;height:500px"></div></body></html>', {
  pretendToBeVisual: true,
});
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  SVGElement: dom.window.SVGElement,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

function local(el: Element): string {
  return (el.localName || el.tagName).toLowerCase().replace(/^.*:/, '');
}

function extractM27PlXml(): string {
  execSync('python _smoke/_extract_3c30_m27.py', { encoding: 'utf-8' });
  return fs.readFileSync('_smoke/_3c30_m27_p5.xml', 'utf8');
}

function noteStaffN(note: Element): number {
  const t = note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim();
  const n = parseInt(t || '1', 10);
  return Number.isFinite(n) ? n : 1;
}

function tags(m: Element): string {
  return [...m.children]
    .map((el) => {
      const t = local(el);
      if (t === 'note') {
        const st = noteStaffN(el);
        const step = el.querySelector('step, *|step')?.textContent ?? (el.querySelector('rest') ? 'R' : '?');
        const v = el.querySelector('voice, *|voice')?.textContent ?? '?';
        const po = el.getAttribute('print-object') || '';
        return `N:${step}s${st}v${v}${po === 'no' ? '(hid)' : ''}`;
      }
      if (t === 'attributes') {
        const signs = [...el.querySelectorAll('sign, *|sign')].map((s) => s.textContent);
        return `A:${signs.join(',') || '∅'}`;
      }
      if (t === 'backup' || t === 'forward') return t;
      return t;
    })
    .join(' ');
}

function transformPl(measure: Element): void {
  // keep staff 2 only
  for (const child of [...measure.children]) {
    if (local(child) === 'note' && noteStaffN(child) !== 2) child.remove();
  }
  // normalize mid clef number like HITL
  let seen = false;
  for (const child of [...measure.children]) {
    const t = local(child);
    if (t === 'note') {
      seen = true;
      continue;
    }
    if (t !== 'attributes') continue;
    for (const clef of [...child.children].filter((c) => local(c) === 'clef')) {
      const num = clef.getAttribute('number');
      if (num && parseInt(num, 10) !== 2) clef.remove();
      else clef.setAttribute('number', '1');
    }
    if (!seen) {
      /* header staves skipped for this smoke */
    }
  }
  pruneCrossStaffTimelineForOsmdPreview(measure, 2);
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
  measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
    el.textContent = '1';
  });
  anchorTrailingMidClefsInMeasure(measure);
}

function countVf(osmd: InstanceType<typeof OpenSheetMusicDisplay>): number {
  let n = 0;
  for (const row of osmd.GraphicSheet.MeasureList ?? []) {
    for (const gm of row ?? []) {
      if (!gm) continue;
      for (const se of gm.staffEntries ?? []) if (se.vfClefBefore) n += 1;
    }
  }
  return n;
}

async function main() {
  const raw = extractM27PlXml();
  const doc = new DOMParser().parseFromString(raw, 'text/xml');
  const measure = doc.querySelector('measure')!;
  console.log('before', tags(measure));
  transformPl(measure);
  console.log('after', tags(measure));
  const xml = '<?xml version="1.0"?>' + new XMLSerializer().serializeToString(doc);
  fs.writeFileSync('_smoke/_3c30_m27_pl_preview.xml', xml, 'utf8');

  const host = document.getElementById('h')!;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawTitle: false });
  await osmd.load(xml);
  osmd.render();
  const n = countVf(osmd);
  console.log('vfClefBefore', n);
  if (n < 1) throw new Error('m27 PL mid G still not drawn');
  console.log('3c30_m27_pl_clef ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
