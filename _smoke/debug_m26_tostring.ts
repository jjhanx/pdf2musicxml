/** P1 vs P123 OSMD m25-27 with Pitch.ToString */
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

function load(raw: string, parts: string[]): string {
  let out = repairTimelineForOsmdPreview(repairRestDisplayForOsmdPreview(raw));
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse');
  const keep = new Set(parts);
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
  try {
    await osmd.load(xml);
  } catch (e) {
    console.log(label, 'LOAD FAIL', e instanceof Error ? e.message : e);
    return;
  }
  osmd.render();
  const sms = ((osmd as unknown as Record<string, unknown>).Sheet as { SourceMeasures?: Array<Record<string, unknown>> })
    ?.SourceMeasures ?? [];
  console.log('\n' + label);
  for (const sm of sms) {
    const n = Number(sm.MeasureNumberXML ?? sm.MeasureNumber ?? 0);
    if (n < 25 || n > 27) continue;
    const ps: string[] = [];
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      const entries = (c as Record<string, unknown>).StaffEntries as unknown[] | undefined;
      for (let si = 0; si < (entries?.length ?? 0); si++) {
        const se = entries![si] as Record<string, unknown> | null;
        if (!se) continue;
        for (const ve of (se.VoiceEntries as unknown[]) ?? []) {
          for (const note of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            const p = (note as Record<string, unknown>).Pitch as { ToString?: () => string } | undefined;
            ps.push(`st${si}:${p?.ToString?.() ?? '?'}`);
          }
        }
      }
    }
    console.log(' m' + n, ps.join(' | '));
  }
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  await dump('P1', load(raw, ['P1']));
  await dump('P123', load(raw, ['P1', 'P2', 'P3']));
}

void main();
