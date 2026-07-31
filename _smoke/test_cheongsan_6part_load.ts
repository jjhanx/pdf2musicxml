/** Load public/cheongsan-preview.xml — source m26 + graphic layout */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { forEachOsmdSystem, measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1600px;height:8000px"></div></body></html>');
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

function smPitches(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mnum: number): string[] {
  const sheet = (osmd as unknown as Record<string, unknown>).Sheet as {
    SourceMeasures?: Array<Record<string, unknown>>;
  };
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const out: string[] = [];
  for (const sm of sheet?.SourceMeasures ?? []) {
    const num = Number(sm.MeasureNumberXML ?? sm.MeasureNumber ?? 0);
    if (num !== mnum) continue;
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      for (const se of ((c as Record<string, unknown>).StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          for (const note of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            const p = (note as Record<string, unknown>).Pitch as Record<string, unknown> | undefined;
            if (!p) continue;
            const step = steps[Number(p.FundamentalNote ?? 0)] ?? '?';
            out.push(step + String((Number(p.Octave ?? 0) + 3) as number));
          }
        }
      }
    }
  }
  return out;
}

async function main() {
  const xml = readFileSync('public/cheongsan-preview.xml', 'utf8');
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: true,
    backend: 'svg',
    drawMeasureNumbers: false,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  try {
    await osmd.load(xml);
  } catch (e) {
    console.error('LOAD FAIL', e instanceof Error ? e.message : e);
    process.exit(1);
  }
  osmd.zoom = 0.4;
  osmd.render();
  console.log('source m26', smPitches(osmd, 26).slice(0, 8));
  console.log('source m27', smPitches(osmd, 27).slice(0, 8));
  forEachOsmdSystem(osmd, (_s, rows) => {
    const nums = new Set<number>();
    for (const row of rows) {
      for (const gm of row) {
        const n = measureMxlFromGraphic(gm as Record<string, unknown>);
        if (n != null && n >= 24 && n <= 28) nums.add(n);
      }
    }
    if (nums.size) console.log('system', [...nums].sort((a, b) => a - b).join(','), 'cols', Math.max(...rows.map((r) => r.length)));
  });
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
