/** P123 m25-27 source pitches: raw vs cleaned */
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

function prep(raw: string, cleanup: boolean): string {
  let out = raw;
  if (cleanup) {
    out = repairTimelineForOsmdPreview(repairRestDisplayForOsmdPreview(out));
  }
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse');
  const keep = new Set(['P1', 'P2', 'P3']);
  for (const p of [...doc.querySelectorAll('part, *|part')]) {
    if (!keep.has(p.getAttribute('id') ?? '')) p.parentNode?.removeChild(p);
  }
  const pl = [...doc.documentElement.children].find(
    (c) => (c.localName?.toLowerCase() ?? c.tagName.toLowerCase()) === 'part-list',
  );
  if (pl) {
    for (const sp of [...pl.children]) {
      const tag = sp.localName?.toLowerCase() ?? sp.tagName.toLowerCase();
      if (tag === 'score-part' && !keep.has(sp.getAttribute('id') ?? '')) pl.removeChild(sp);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

async function dump(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.render();
  const sms = ((osmd as unknown as Record<string, unknown>).Sheet as { SourceMeasures?: Array<Record<string, unknown>> })
    ?.SourceMeasures ?? [];
  console.log(label);
  for (const sm of sms) {
    const n = Number(sm.MeasureNumberXML ?? sm.MeasureNumber ?? 0);
    if (n < 25 || n > 27) continue;
    const ps: string[] = [];
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      for (const se of ((c as Record<string, unknown>).StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          for (const note of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            const p = (note as Record<string, unknown>).Pitch as { ToString?: () => string } | undefined;
            ps.push(p?.ToString?.() ?? 'R');
          }
        }
      }
    }
    console.log(' m' + n, ps.slice(0, 6).join(' | '));
  }
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  await dump('RAW P123', prep(raw, false));
  await dump('CLEAN P123', prep(raw, true));
}

void main();
