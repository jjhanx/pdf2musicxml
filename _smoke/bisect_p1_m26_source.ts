import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1400px;height:4000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }
function p1only(xml: string): string {
  const doc = parseMusicXmlDocument(xml)!;
  for (const p of [...doc.querySelectorAll('part')]) {
    if (p.getAttribute('id') !== 'P1') p.parentNode?.removeChild(p);
    else for (const c of [...p.children]) if (local(c) === 'measure' && parseInt(c.getAttribute('number') ?? '0', 10) > 28) p.removeChild(c);
  }
  const pl = [...doc.documentElement.children].find(c => local(c) === 'part-list');
  if (pl) for (const sp of [...pl.children]) if (local(sp) === 'score-part' && sp.getAttribute('id') !== 'P1') pl.removeChild(sp);
  doc.querySelectorAll('octave-shift').forEach(e => e.remove());
  return serializeMusicXmlDocument(doc);
}

const STEPS = ['C','D','E','F','G','A','B'];
function dumpM26(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay): string[] {
  const out: string[] = [];
  const sheet = (osmd as unknown as { Sheet?: { SourceMeasures?: Array<Record<string, unknown>> } }).Sheet;
  for (const sm of sheet?.SourceMeasures ?? []) {
    if (Number(sm.MeasureNumberXML ?? sm.MeasureNumber) !== 26) continue;
    console.log('  hasError', sm.HasError ?? sm.hasError, 'implicit', sm.IsImplicitMeasure ?? sm.isImplicitMeasure);
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      for (const se of ((c as Record<string, unknown>).StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          for (const n of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            const p = (n as Record<string, unknown>).Pitch as Record<string, unknown> | undefined;
            if (p) out.push(`${STEPS[Number(p.FundamentalNote)]}${p.Octave}`);
          }
        }
      }
    }
  }
  return out;
}

async function tryCase(label: string, xml: string) {
  const slice = p1only(xml);
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host')!; host.innerHTML='';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
  try {
    await osmd.load(slice);
    osmd.render();
    console.log(label, 'OK', dumpM26(osmd));
  } catch (e) {
    console.log(label, 'FAIL', e instanceof Error ? e.message : e);
  }
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  await tryCase('raw', raw);
  await tryCase('+timeline', repairTimelineForOsmdPreview(raw));
  await tryCase('+underfull', repairUnderfullMeasuresForOsmdPreview(repairTimelineForOsmdPreview(raw)));
  await tryCase('+restDisplay', repairRestDisplayForOsmdPreview(repairTimelineForOsmdPreview(raw)));
  await tryCase('+missingTypes', repairMissingNoteTypesForOsmdPreview(repairTimelineForOsmdPreview(raw)));
}
void main();
