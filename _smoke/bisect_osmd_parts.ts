/**
 * Find which part combo triggers OSMD "duration u" with cheongsan m1-30.
 * Run: npx tsx _smoke/bisect_osmd_parts.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
Object.assign(g, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function filterParts(xml: string, partIds: string[], maxMeasure = 30): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse fail');
  const keep = new Set(partIds);
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '';
    if (!keep.has(pid)) {
      part.parentNode?.removeChild(part);
      continue;
    }
    for (const child of [...part.children]) {
      if (local(child) !== 'measure') continue;
      const n = parseInt(child.getAttribute('number') ?? '0', 10);
      if (n > maxMeasure) part.removeChild(child);
    }
  }
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  if (partList) {
    for (const sp of [...partList.children]) {
      if (local(sp) !== 'score-part') continue;
      const id = sp.getAttribute('id') ?? '';
      if (!keep.has(id)) partList.removeChild(sp);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

async function tryLoad(label: string, xml: string): Promise<boolean> {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawMeasureNumbers: false,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  try {
    await osmd.load(xml);
    osmd.render();
    console.log('OK', label);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('FAIL', label, msg.slice(0, 100));
    return false;
  }
}

async function main() {
  let xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = repairTimelineForOsmdPreview(xml);

  const parts = ['P1', 'P2', 'P3', 'P4', 'P5'];
  for (const p of parts) {
    await tryLoad(p, filterParts(xml, [p]));
  }
  for (let i = 0; i < parts.length; i++) {
    const combo = parts.slice(0, i + 1);
    await tryLoad(combo.join('+'), filterParts(xml, combo));
  }
  await tryLoad('P1+P5', filterParts(xml, ['P1', 'P5']));
  await tryLoad('P1-P4', filterParts(xml, ['P1', 'P2', 'P3', 'P4']));
}

void main();
