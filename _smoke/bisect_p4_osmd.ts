/**
 * Bisect P4 measure that triggers OSMD duration-u error.
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

function p4(xml: string, maxM: number): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    if (part.getAttribute('id') !== 'P4') part.parentNode?.removeChild(part);
    else {
      for (const child of [...part.children]) {
        if (local(child) !== 'measure') continue;
        if (parseInt(child.getAttribute('number') ?? '0', 10) > maxM) part.removeChild(child);
      }
    }
  }
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  if (partList) {
    for (const sp of [...partList.children]) {
      if (local(sp) !== 'score-part') continue;
      if (sp.getAttribute('id') !== 'P4') partList.removeChild(sp);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

async function tryM(maxM: number, xml: string): Promise<boolean> {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  try {
    await osmd.load(p4(xml, maxM));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = repairTimelineForOsmdPreview(xml);
  let lo = 1;
  let hi = 40;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (await tryM(mid, xml)) lo = mid;
    else hi = mid - 1;
  }
  console.log('P4 last ok measure', lo);
  if (lo < 40) console.log('P4 first fail measure', lo + 1);
}

void main();
