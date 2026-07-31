/**
 * OSMD load 6-part preview XML (after split+cleanup).
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

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

function smNum(sm: Record<string, unknown>): number {
  return Number(sm.MeasureNumberXML ?? sm.MeasureNumber ?? sm.measureNumber ?? 0);
}

function smPitchesForPart(sms: Record<string, unknown>[], mnum: number, partIdx: number): string[] {
  // first staff of part only — approximate via measure list order
  const sm = sms[mnum - 1];
  if (!sm) return [];
  const out: string[] = [];
  for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
    const rec = c as Record<string, unknown>;
    for (const se of (rec.StaffEntries as unknown[]) ?? []) {
      if (!se) continue;
      for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
        for (const note of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
          const p = (note as Record<string, unknown>).Pitch as Record<string, unknown> | undefined;
          if (!p) continue;
          const step = ['C', 'D', 'E', 'F', 'G', 'A', 'B'][Number(p.FundamentalNote ?? 0)] ?? '?';
          out.push(step + String(p.Octave ?? ''));
        }
      }
    }
  }
  void partIdx;
  return out;
}

async function main() {
  const xml = readFileSync('_smoke/_cheongsan_preview_6part_clean.xml', 'utf8');
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  try {
    await osmd.load(xml);
    osmd.render();
    const sms = ((osmd as unknown as Record<string, unknown>).Sheet as { SourceMeasures?: Record<string, unknown>[] })
      ?.SourceMeasures ?? [];
    console.log('loaded measures', sms.length);
    for (const n of [25, 26, 27]) {
      const sm = sms.find((x) => smNum(x) === n);
      console.log('m' + n, sm ? smPitchesForPart(sms, n, 0).slice(0, 8) : 'MISSING');
    }
  } catch (e) {
    console.log('LOAD FAIL', e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

void main();
