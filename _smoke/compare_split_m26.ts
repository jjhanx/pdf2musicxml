import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1600px;height:8000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

const STEPS = ['C','D','E','F','G','A','B'];

function pitches(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mn: number, partId: string): string[] {
  const sheet = (osmd as unknown as { Sheet?: Record<string, unknown> }).Sheet!;
  const out: string[] = [];
  for (const sm of (sheet.SourceMeasures as Array<Record<string, unknown>>) ?? []) {
    if (Number(sm.MeasureNumberXML ?? sm.MeasureNumber) !== mn) continue;
    for (const c of (sm.VerticalSourceStaffEntryContainers as Array<Record<string, unknown>>) ?? []) {
      for (const se of (c.StaffEntries as Array<Record<string, unknown>>) ?? []) {
        if (!se) continue;
        const inst = se.ParentStaff as Record<string, unknown> | undefined;
        const instr = inst?.ParentInstrument as Record<string, unknown> | undefined;
        const pid = String(instr?.IdString ?? '');
        if (pid !== partId) continue;
        for (const ve of (se.VoiceEntries as Array<Record<string, unknown>>) ?? []) {
          for (const n of (ve.Notes as Array<Record<string, unknown>>) ?? []) {
            const p = n.Pitch as Record<string, unknown> | undefined;
            if (p) out.push(`${STEPS[Number(p.FundamentalNote)]}${p.Octave}`);
          }
        }
      }
    }
  }
  return out;
}

async function load(label: string, path: string) {
  const xml = readFileSync(path, 'utf8');
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host')!; host.innerHTML='';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
  await osmd.load(xml);
  osmd.render();
  console.log(label, 'P1 m26', pitches(osmd, 26, 'P1'));
  console.log(label, 'P5__PL m26', pitches(osmd, 26, 'P5__PL'));
}

async function main() {
  await load('6part split preview', '_smoke/_preview_pipeline.xml');
}
void main().catch(e => { console.error(e); process.exit(1); });
