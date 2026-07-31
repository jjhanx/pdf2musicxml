import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:12000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }

function filterParts(xml: string, ids: string[]): string {
  const doc = parseMusicXmlDocument(xml)!;
  const keep = new Set(ids);
  for (const p of [...doc.querySelectorAll('part')]) {
    if (!keep.has(p.getAttribute('id') ?? '')) p.parentNode?.removeChild(p);
    else for (const c of [...p.children]) if (local(c) === 'measure' && parseInt(c.getAttribute('number') ?? '0', 10) > 30) p.removeChild(c);
  }
  const pl = [...doc.documentElement.children].find(c => local(c) === 'part-list');
  if (pl) for (const sp of [...pl.children]) if (local(sp) === 'score-part' && !keep.has(sp.getAttribute('id') ?? '')) pl.removeChild(sp);
  doc.querySelectorAll('octave-shift').forEach(e => e.remove());
  return serializeMusicXmlDocument(doc);
}

function missingTypes(xml: string): Array<{ part: string; measure: string; tag: string }> {
  const doc = parseMusicXmlDocument(xml)!;
  const out: Array<{ part: string; measure: string; tag: string }> = [];
  for (const p of [...doc.querySelectorAll('part')]) {
    const pid = p.getAttribute('id') ?? '?';
    for (const m of [...p.children]) {
      if (local(m) !== 'measure') continue;
      const mn = m.getAttribute('number') ?? '?';
      for (const n of [...m.querySelectorAll('note, rest')]) {
        if (local(n) === 'note' && n.querySelector('grace')) continue;
        const typeEl = n.querySelector(':scope > type, :scope > *|type');
        if (!typeEl?.textContent?.trim()) out.push({ part: pid, measure: mn, tag: local(n) });
      }
    }
  }
  return out;
}

async function tryLoad(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host')!; host.innerHTML='';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  try {
    await osmd.load(xml);
    console.log(label, 'OK');
  } catch (e) {
    console.log(label, 'FAIL', JSON.stringify(e));
  }
}

async function main() {
  let xml = repairMissingNoteTypesForOsmdPreview(repairRestDisplayForOsmdPreview(repairTimelineForOsmdPreview(readFileSync('_smoke/_preview_pipeline.xml', 'utf8'))));
  for (const pid of ['P4', 'P5__PR', 'P5__PL']) {
    const miss = missingTypes(filterParts(xml, [pid]));
    console.log(pid, 'missing types', miss.length, miss.slice(0, 5));
  }
  await tryLoad('P1-P3', filterParts(xml, ['P1','P2','P3']));
  await tryLoad('P1-P4', filterParts(xml, ['P1','P2','P3','P4']));
  await tryLoad('P4 only', filterParts(xml, ['P4']));
}
void main();
