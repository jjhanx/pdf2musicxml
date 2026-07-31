/** OSMD source model vs XML for P1 m25-27 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1400px;height:4000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }

function prep(): string {
  let xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = repairMissingNoteTypesForOsmdPreview(xml);
  xml = repairTimelineForOsmdPreview(xml);
  const doc = parseMusicXmlDocument(xml)!;
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    if (part.getAttribute('id') !== 'P1') part.parentNode?.removeChild(part);
    else for (const c of [...part.children]) {
      if (local(c) === 'measure' && parseInt(c.getAttribute('number') ?? '0', 10) > 28) part.removeChild(c);
    }
  }
  return serializeMusicXmlDocument(doc);
}

function xmlFirstPitch(xml: string, m: number): string {
  const doc = parseMusicXmlDocument(xml)!;
  const part = doc.querySelector('part[id="P1"], part');
  const meas = [...part!.children].find(c => local(c) === 'measure' && c.getAttribute('number') === String(m)) as Element;
  const note = meas.querySelector('note:not(:has(chord))') ?? meas.querySelector('note');
  const p = note?.querySelector('pitch step, *|step');
  const o = note?.querySelector('pitch octave, *|octave');
  return `${p?.textContent}${o?.textContent}`;
}

function sourcePitches(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, m: number): string[] {
  const sheet = (osmd as unknown as { Sheet?: { SourceMeasures?: Array<Record<string, unknown>> } }).Sheet;
  const out: string[] = [];
  for (const sm of sheet?.SourceMeasures ?? []) {
    const num = Number(sm.MeasureNumberXML ?? sm.MeasureNumber ?? 0);
    if (num !== m) continue;
    const vc = sm.VerticalSourceStaffEntryContainers as Array<Record<string, unknown>> | undefined;
    for (const c of vc ?? []) {
      const ses = c.StaffEntries as Array<Record<string, unknown> | null> | undefined;
      for (const se of ses ?? []) {
        if (!se) continue;
        const ves = se.VoiceEntries as Array<Record<string, unknown>> | undefined;
        for (const ve of ves ?? []) {
          const notes = ve.Notes as Array<Record<string, unknown>> | undefined;
          for (const n of notes ?? []) {
            const pitch = n.Pitch as { ToString?: () => string } | undefined;
            out.push(pitch?.ToString?.() ?? '?');
          }
        }
      }
    }
  }
  return out;
}

async function main() {
  const xml = prep();
  for (const m of [25, 26, 27]) console.log('XML m'+m, xmlFirstPitch(xml, m));

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  for (const autoResize of [false, true]) {
    host.innerHTML = '';
    const osmd = new OpenSheetMusicDisplay(host, { autoResize, backend: 'svg', drawMeasureNumbers: false } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
    await osmd.load(xml);
    osmd.zoom = 0.35;
    osmd.render();
    console.log('\nautoResize='+autoResize);
    for (const m of [25, 26, 27]) console.log('  source m'+m, sourcePitches(osmd, m).slice(0, 4).join(', '));
    const sheet = (osmd as unknown as { GraphicSheet?: { MeasureList?: Record<string, unknown>[][] } }).GraphicSheet;
    const row = sheet?.MeasureList?.[0] ?? [];
    for (const gm of row) {
      if (!gm) continue;
      const sm = (gm as Record<string, unknown>).parentSourceMeasure ?? (gm as Record<string, unknown>).ParentSourceMeasure;
      const n = Number((sm as Record<string, unknown>)?.MeasureNumberXML ?? (sm as Record<string, unknown>)?.MeasureNumber ?? -1);
      if (n < 25 || n > 27) continue;
      const bb = (gm as Record<string, unknown>).PositionAndShape as Record<string, unknown> | undefined;
      const size = bb?.Size as Record<string, unknown> | undefined;
      const w = Number(size?.width ?? size?.Width ?? 0);
      console.log('  graphic m'+n, 'w='+w.toFixed(2));
    }
  }
}

void main();
