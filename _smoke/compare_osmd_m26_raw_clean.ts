/**
 * Compare OSMD SourceMeasures m25-27 raw vs cleaned (P1 m1-28).
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
Object.assign(g, {
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

function prep(xml: string, cleanup: boolean): string {
  let out = xml;
  if (cleanup) {
    out = repairRestDisplayForOsmdPreview(out);
    out = repairTimelineForOsmdPreview(out);
  }
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    if (part.getAttribute('id') !== 'P1') part.parentNode?.removeChild(part);
    else {
      for (const child of [...part.children]) {
        if (local(child) !== 'measure') continue;
        if (parseInt(child.getAttribute('number') ?? '0', 10) > 28) part.removeChild(child);
      }
    }
  }
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  if (partList) {
    for (const sp of [...partList.children]) {
      if (local(sp) !== 'score-part') continue;
      if (sp.getAttribute('id') !== 'P1') partList.removeChild(sp);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

function smNum(sm: Record<string, unknown>): number {
  return Number(sm.MeasureNumberXML ?? sm.measureNumberXML ?? sm.MeasureNumber ?? sm.measureNumber ?? 0);
}

function smPitches(sm: Record<string, unknown>): string[] {
  const out: string[] = [];
  const containers = sm.VerticalSourceStaffEntryContainers as unknown[] | undefined;
  for (const c of containers ?? []) {
    const rec = c as Record<string, unknown>;
    const entries = rec.StaffEntries as unknown[] | undefined;
    for (const se of entries ?? []) {
      if (!se) continue;
      const srec = se as Record<string, unknown>;
      const voiceEntries = srec.VoiceEntries as unknown[] | undefined;
      for (const ve of voiceEntries ?? []) {
        const vrec = ve as Record<string, unknown>;
        const notes = vrec.Notes as unknown[] | undefined;
        for (const note of notes ?? []) {
          const nrec = note as Record<string, unknown>;
          const pitch = nrec.Pitch as Record<string, unknown> | undefined;
          if (!pitch) continue;
          out.push(String(pitch.FundamentalNote ?? pitch.fundamentalNote) + String(pitch.Octave ?? pitch.octave));
        }
      }
    }
  }
  return out;
}

async function run(label: string, cleanup: boolean) {
  const xml = prep(readFileSync('_smoke/_cheongsan_review.xml', 'utf8'), cleanup);
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.render();
  const sms = ((osmd as unknown as Record<string, unknown>).Sheet as { SourceMeasures?: Record<string, unknown>[] })
    ?.SourceMeasures ?? [];
  console.log(`\n${label}`);
  for (const sm of sms) {
    const n = smNum(sm);
    if (n < 25 || n > 27) continue;
    console.log(` m${n}`, smPitches(sm));
  }
}

async function main() {
  await run('RAW dangling backup', false);
  await run('CLEANED', true);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
