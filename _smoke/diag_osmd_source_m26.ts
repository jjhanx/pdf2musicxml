import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairMissingNoteTypesForOsmdPreview, repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

// copy buildPreviewXml from test_0ea5 - abbreviated
function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }
function noteStaff(n: Element) { return parseInt(n.querySelector(':scope > staff')?.textContent?.trim() ?? '1', 10) || 1; }
function splitGrandStaff(xml: string): string {
  const doc = parseMusicXmlDocument(xml)!;
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  for (const part of [...doc.querySelectorAll('part')]) {
    const pid = part.getAttribute('id');
    if (!pid || pid.includes('__')) continue;
    let max = 1;
    part.querySelectorAll('note staff').forEach((s) => { max = Math.max(max, parseInt(s.textContent ?? '1', 10)); });
    if (max < 2) continue;
    const mk = (sn: number, suf: string) => {
      const p = part.cloneNode(true) as Element;
      p.setAttribute('id', `${pid}__${suf}`);
      for (const m of [...p.children]) {
        if (local(m) !== 'measure') continue;
        for (const n of [...m.querySelectorAll('note')]) if (noteStaff(n) !== sn) n.remove();
        m.querySelectorAll('note staff').forEach((s) => { s.textContent = '1'; });
      }
      return p;
    };
    part.parentNode!.insertBefore(mk(1, 'PR'), part);
    part.parentNode!.insertBefore(mk(2, 'PL'), part);
    part.parentNode!.removeChild(part);
    if (partList) {
      const sp = [...partList.children].find((c) => local(c) === 'score-part' && c.getAttribute('id') === pid);
      if (sp) {
        const clone = (id: string) => { const n = sp.cloneNode(false) as Element; n.setAttribute('id', id); return n; };
        partList.insertBefore(clone(`${pid}__PR`), sp);
        partList.insertBefore(clone(`${pid}__PL`), sp);
        partList.removeChild(sp);
      }
    }
  }
  return serializeMusicXmlDocument(doc);
}
function buildPreviewXml(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  xml = splitGrandStaff(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = repairMissingNoteTypesForOsmdPreview(repairRestDisplayForOsmdPreview(xml));
  return repairTimelineForOsmdPreview(xml);
}

function pitchStr(note: Record<string, unknown>): string {
  const p = note.Pitch as Record<string, unknown> | undefined;
  if (!p) return '?';
  if (typeof p.ToString === 'function') return (p.ToString as () => string)();
  if (typeof p.toString === 'function') return (p.toString as () => string)();
  return JSON.stringify(p);
}

function dumpMeasure(sheet: Record<string, unknown>, mn: number) {
  const measures = sheet.sourceMeasures as unknown[];
  for (const sm of measures ?? []) {
    const rec = sm as Record<string, unknown>;
    const n = Number(rec.MeasureNumber ?? rec.MeasureNumberXML ?? rec.measureNumber ?? 0);
    if (n !== mn) continue;
    const containers = rec.VerticalSourceStaffEntryContainers as unknown[];
    console.log(`\nsource m${mn} containers=${containers?.length}`);
    for (let ci = 0; ci < Math.min(3, containers?.length ?? 0); ci++) {
      const c = containers![ci] as Record<string, unknown>;
      const entries = c.StaffEntries as unknown[];
      for (let si = 0; si < (entries?.length ?? 0); si++) {
        const se = entries![si] as Record<string, unknown>;
        if (!se) continue;
        const pitches: string[] = [];
        for (const ve of (se.VoiceEntries as unknown[]) ?? []) {
          for (const note of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            pitches.push(pitchStr(note as Record<string, unknown>));
          }
        }
        if (pitches.length) console.log(`  c${ci} st${si}: ${pitches.join(',')}`);
      }
    }
  }
}

async function main() {
  const xml = buildPreviewXml(readFileSync('_smoke/_cheongsan_review.xml', 'utf8'));
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const osmd = new OpenSheetMusicDisplay(document.getElementById('host')!, { backend: 'svg' });
  await osmd.load(xml);
  osmd.render();
  const sheet = (osmd as unknown as Record<string, unknown>).Sheet as Record<string, unknown>;
  for (const mn of [25, 26, 27]) dumpMeasure(sheet, mn);
}
void main();
