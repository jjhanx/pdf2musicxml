import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairMissingNoteTypesForOsmdPreview, repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { forEachOsmdSystem, measureMxlFromGraphic, partIdFromGraphic } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:12000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

// minimal split from test file inline
function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }
function load() { return readFileSync('_smoke/_cheongsan_review.xml', 'utf8'); }
function noteStaff(n: Element) { return parseInt(n.querySelector(':scope > staff')?.textContent?.trim() ?? '1', 10) || 1; }
function split(xml: string): string {
  const doc = parseMusicXmlDocument(repairTimelineForOsmdPreview(xml))!;
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
        for (const note of [...m.querySelectorAll('note')]) if (noteStaff(note) !== sn) note.remove();
        m.querySelectorAll('note staff').forEach((s) => { s.textContent = '1'; });
      }
      return p;
    };
    part.parentNode!.insertBefore(mk(1, 'PR'), part);
    part.parentNode!.insertBefore(mk(2, 'PL'), part);
    part.parentNode!.removeChild(part);
  }
  let out = serializeMusicXmlDocument(doc);
  out = repairTimelineForOsmdPreview(out);
  out = repairUnderfullMeasuresForOsmdPreview(out);
  out = repairMissingNoteTypesForOsmdPreview(repairRestDisplayForOsmdPreview(out));
  return out;
}

function pitches(gm: Record<string, unknown>): string[] {
  const out: string[] = [];
  const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  for (const entry of (gm.staffEntries ?? gm.StaffEntries) as unknown[] ?? []) {
    for (const gve of ((entry as Record<string, unknown>).graphicalVoiceEntries ?? (entry as Record<string, unknown>).GraphicalVoiceEntries) as unknown[] ?? []) {
      for (const note of ((gve as Record<string, unknown>).notes ?? (gve as Record<string, unknown>).Notes) as unknown[] ?? []) {
        const src = ((note as Record<string, unknown>).sourceNote ?? (note as Record<string, unknown>).SourceNote) as Record<string, unknown>;
        const p = (src?.Pitch ?? src?.pitch) as Record<string, unknown>;
        const fn = p?.FundamentalNote ?? p?.fundamentalNote;
        const oct = p?.Octave ?? p?.octave;
        if (typeof fn === 'number' && typeof oct === 'number') out.push(`${names[fn]}${oct}`);
      }
    }
  }
  return out;
}

async function main() {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(split(load()));
  osmd.render();
  forEachOsmdSystem(osmd, (_s, rows) => {
    for (let si = 0; si < Math.min(rows.length, 7); si++) {
      for (const gm of rows[si] ?? []) {
        const n = measureMxlFromGraphic(gm as Record<string, unknown>);
        if (n == null || n < 25 || n > 27) continue;
        const pid = partIdFromGraphic(gm as Record<string, unknown>);
        const ps = pitches(gm as Record<string, unknown>).slice(0, 4).join(',');
        console.log(`st${si} ${pid} graphic m${n}: [${ps}]`);
      }
    }
  });
}
void main();
