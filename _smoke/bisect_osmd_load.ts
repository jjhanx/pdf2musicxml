/**
 * Bisect OSMD load failure ("duration u") in cheongsan score.
 * Run: npx tsx _smoke/bisect_osmd_load.ts
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

function truncateToMeasure(xml: string, maxMeasure: number, partIds?: string[]): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse fail');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '';
    if (partIds && !partIds.includes(pid)) {
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
  if (partList && partIds) {
    for (const sp of [...partList.children]) {
      if (local(sp) !== 'score-part') continue;
      const id = sp.getAttribute('id') ?? '';
      if (!partIds.includes(id)) partList.removeChild(sp);
    }
  }
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
    console.log('FAIL', label, msg.slice(0, 120));
    return false;
  }
}

async function main() {
  let xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  xml = promoteMinimal(xml);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = repairTimelineForOsmdPreview(xml);

  for (const max of [26, 27, 28, 30, 40, 60]) {
    await tryLoad(`P1 only m1-${max}`, truncateToMeasure(xml, max, ['P1']));
  }
  for (const max of [26, 27, 28, 30]) {
    await tryLoad(`all parts m1-${max}`, truncateToMeasure(xml, max));
  }
}

function promoteMinimal(xml: string): string {
  // strip octave-shift like sanitizeMusicXmlForOsmd
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return xml;
  doc.querySelectorAll('*').forEach((el) => {
    if (local(el) === 'octave-shift') el.remove();
  });
  return serializeMusicXmlDocument(doc);
}

void main();
