/**
 * Run: npx tsx _smoke/test_tempo_preview_m1_notes.ts
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;

function countM1(xml: string, label: string): number {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
  let total = 0;
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '?';
    for (const meas of [...part.children]) {
      if (local(meas as Element) !== 'measure') continue;
      if ((meas as Element).getAttribute('number') !== '1') continue;
      const notes = [...meas.children].filter((c) => local(c as Element) === 'note').length;
      const tags = [...meas.children].slice(0, 10).map((c) => local(c as Element));
      console.log(`${label} ${pid}: notes=${notes} [${tags.join(',')}]`);
      total += notes;
    }
  }
  return total;
}

const raw = fs.readFileSync('_smoke/_tempo_applied.xml', 'utf8');
const mod = await import('../src/AudiverisInspectPanel.tsx');
const scoreParts = [
  { id: 'P1', displayLabel: 'S' },
  { id: 'P2', displayLabel: 'A' },
  { id: 'P3', displayLabel: 'T' },
  { id: 'P4', displayLabel: 'B' },
];
console.log('RAW:');
const rawTotal = countM1(raw, ' ');
const preview = mod.buildOsmdPreviewXml(raw, scoreParts, null, { verbatim: true });
console.log('PREVIEW:');
const prevTotal = countM1(preview, ' ');
if (prevTotal < rawTotal) {
  console.error(`FAIL notes lost: ${rawTotal} -> ${prevTotal}`);
  process.exit(1);
}

const host = document.createElement('div');
host.style.width = '1200px';
const osmd = new OpenSheetMusicDisplay(host, { drawTitle: false, drawComposer: false });
await osmd.load(preview);
await osmd.render();
const noteheads = host.querySelectorAll('.vf-notehead, .osmd-notehead');
console.log('OSMD noteheads in SVG:', noteheads.length);
if (noteheads.length === 0) {
  console.error('FAIL OSMD rendered zero noteheads');
  process.exit(1);
}
console.log('OK');
