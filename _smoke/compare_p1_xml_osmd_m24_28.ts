import { readFileSync, writeFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1400px;height:4000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }

function p1slice(raw: string): string {
  const doc = parseMusicXmlDocument(raw)!;
  const p1 = [...doc.querySelectorAll('part')].find(p => p.getAttribute('id') === 'P1')!;
  for (const c of [...p1.children]) if (local(c) === 'measure' && parseInt(c.getAttribute('number') ?? '0', 10) > 28) p1.removeChild(c);
  const root = parseMusicXmlDocument('<?xml version="1.0"?><score-partwise version="3.0"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list></score-partwise>')!;
  root.documentElement.appendChild(p1.cloneNode(true));
  return serializeMusicXmlDocument(root);
}

function xmlNotes(xml: string, mn: number): string[] {
  const doc = parseMusicXmlDocument(xml)!;
  const p1 = doc.querySelector('part')!;
  const m = [...p1.children].find(c => local(c) === 'measure' && c.getAttribute('number') === String(mn))!;
  return [...m.querySelectorAll('note')].map(n => {
    const p = n.querySelector('pitch');
    if (!p) return 'rest';
    return p.querySelector('step')!.textContent + p.querySelector('octave')!.textContent;
  });
}

function osmdNotes(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mn: number): string[] {
  const out: string[] = [];
  const sheet = (osmd as unknown as { Sheet?: { SourceMeasures?: Array<Record<string, unknown>> } }).Sheet;
  for (const sm of sheet?.SourceMeasures ?? []) {
    const num = Number(sm.MeasureNumberXML ?? sm.MeasureNumber);
    if (num !== mn) continue;
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      for (const se of ((c as Record<string, unknown>).StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          for (const n of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            const p = (n as Record<string, unknown>).Pitch as Record<string, unknown> | undefined;
            if (!p) { out.push('rest'); continue; }
            out.push(`fn${p.FundamentalNote}/oct${p.Octave}`);
          }
        }
      }
    }
  }
  return out;
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const xml = p1slice(raw);
  writeFileSync('_smoke/_p1_m28.xml', xml, 'utf8');
  for (const mn of [24,25,26,27,28]) console.log('XML m'+mn, xmlNotes(xml, mn).join(', '));

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const osmd = new OpenSheetMusicDisplay(document.getElementById('host')!, { backend: 'svg' });
  await osmd.load(xml);
  osmd.render();
  for (const mn of [24,25,26,27,28]) console.log('OSMD m'+mn, osmdNotes(osmd, mn).join(', '));
}
void main().catch(e => { console.error(e); process.exit(1); });
