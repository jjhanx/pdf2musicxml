import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1600px;height:5000px"></div></body></html>');
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
    else for (const c of [...p.children]) if (local(c) === 'measure' && parseInt(c.getAttribute('number') ?? '0', 10) > 28) p.removeChild(c);
  }
  const pl = [...doc.documentElement.children].find(c => local(c) === 'part-list');
  if (pl) for (const sp of [...pl.children]) if (local(sp) === 'score-part' && !keep.has(sp.getAttribute('id') ?? '')) pl.removeChild(sp);
  doc.querySelectorAll('octave-shift').forEach(e => e.remove());
  return serializeMusicXmlDocument(doc);
}

function p1m26(xml: string): string {
  const doc = parseMusicXmlDocument(xml)!;
  const p1 = [...doc.querySelectorAll('part')].find(p => p.getAttribute('id') === 'P1')!;
  const m = [...p1.children].find(c => c.getAttribute('number') === '26')!;
  const n = m.querySelector('note')!;
  return n.querySelector('pitch step')!.textContent + n.querySelector('pitch octave')!.textContent;
}

function smP1F5(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay): boolean {
  const sheet = (osmd as unknown as { Sheet?: { SourceMeasures?: Array<Record<string, unknown>> } }).Sheet;
  for (const sm of sheet?.SourceMeasures ?? []) {
    if (Number(sm.MeasureNumberXML ?? sm.MeasureNumber) !== 26) continue;
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      for (const se of ((c as Record<string, unknown>).StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          for (const n of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            const p = (n as Record<string, unknown>).Pitch as Record<string, unknown> | undefined;
            if (p && Number(p.FundamentalNote) === 3 && Number(p.Octave) === 5) return true;
          }
        }
      }
    }
  }
  return false;
}

async function tryLoad(label: string, xml: string) {
  console.log(label, 'xml m26', p1m26(xml));
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host')!; host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
  try {
    await osmd.load(xml);
    osmd.render();
    console.log(label, 'load OK', 'F5 in source', smP1F5(osmd));
  } catch (e) {
    console.log(label, 'load FAIL', e instanceof Error ? e.message : JSON.stringify(e));
  }
}

async function main() {
  const preview = readFileSync('_smoke/_preview_pipeline.xml', 'utf8');
  for (const parts of [['P1'], ['P1','P2'], ['P1','P2','P3'], ['P1','P2','P3','P4'], ['P1','P2','P3','P4','P5__PR'], ['P1','P2','P3','P4','P5__PR','P5__PL']]) {
    await tryLoad(parts.join('+'), filterParts(preview, parts));
  }
}
void main();
