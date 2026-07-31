import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
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

function prep(ids: string[], max = 28): string {
  let out = repairTimelineForOsmdPreview(repairRestDisplayForOsmdPreview(readFileSync('_smoke/_cheongsan_review.xml', 'utf8')));
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse');
  const keep = new Set(ids);
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '';
    if (!keep.has(pid)) part.parentNode?.removeChild(part);
    else {
      for (const c of [...part.children]) {
        if (local(c) === 'measure' && parseInt(c.getAttribute('number') ?? '0', 10) > max) part.removeChild(c);
      }
    }
  }
  const pl = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  if (pl) {
    for (const sp of [...pl.children]) {
      if (local(sp) === 'score-part' && !keep.has(sp.getAttribute('id') ?? '')) pl.removeChild(sp);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

async function ok(label: string, ids: string[]) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  try {
    await osmd.load(prep(ids));
    console.log('OK', label);
  } catch (e) {
    console.log('FAIL', label, e instanceof Error ? e.message : e);
  }
}

async function main() {
  await ok('P1+P2+P3', ['P1', 'P2', 'P3']);
  await ok('P1+P2+P3+P5', ['P1', 'P2', 'P3', 'P5']);
  await ok('P1-P4 no P5', ['P1', 'P2', 'P3', 'P4']);
}

void main();
