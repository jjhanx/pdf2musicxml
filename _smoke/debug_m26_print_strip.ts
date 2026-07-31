/**
 * P1 m25-27: dangling-only vs full repairTimeline (print strip).
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  removeDanglingTimelineElementsForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';
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

const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function p1only(raw: string, full: boolean): string {
  let out = full
    ? repairTimelineForOsmdPreview(raw)
    : removeDanglingTimelineElementsForOsmdPreview(raw);
  out = repairRestDisplayForOsmdPreview(out);
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    if (part.getAttribute('id') !== 'P1') part.parentNode?.removeChild(part);
  }
  const pl = [...doc.documentElement.children].find(
    (c) => (c.localName?.toLowerCase() ?? c.tagName.toLowerCase()) === 'part-list',
  );
  if (pl) {
    for (const sp of [...pl.children]) {
      if ((sp.localName?.toLowerCase() ?? sp.tagName.toLowerCase()) === 'score-part' && sp.getAttribute('id') !== 'P1') {
        pl.removeChild(sp);
      }
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

async function run(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.render();
  const sms = ((osmd as unknown as Record<string, unknown>).Sheet as { SourceMeasures?: Array<Record<string, unknown>> })
    ?.SourceMeasures ?? [];
  console.log('\n' + label, 'hasPrint', /<print/i.test(xml));
  for (const sm of sms) {
    const n = Number(sm.MeasureNumberXML ?? sm.MeasureNumber ?? 0);
    if (n < 25 || n > 27) continue;
    const ps: string[] = [];
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      for (const se of ((c as Record<string, unknown>).StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          for (const note of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            const p = (note as Record<string, unknown>).Pitch as Record<string, unknown> | undefined;
            if (p) ps.push(steps[Number(p.FundamentalNote ?? 0)] + String(p.Octave ?? ''));
          }
        }
      }
    }
    console.log(' m' + n, ps);
  }
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  await run('dangling only', p1only(raw, false));
  await run('full repairTimeline', p1only(raw, true));
}

void main();
