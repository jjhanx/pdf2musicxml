/**
 * Debug OSMD m25-27 source vs graphic after cleanup.
 * Run: npx tsx _smoke/debug_osmd_m26.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:1400px;height:4000px"></div></body></html>',
);
const g = globalThis as unknown as Record<string, unknown>;
g.document = dom.window.document;
g.window = dom.window;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;
g.SVGElement = dom.window.SVGElement;
g.requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
};

function pitchFromSourceNote(n: unknown): string {
  const rec = n as { Pitch?: { ToString?: () => string }; pitch?: { ToString?: () => string } };
  return rec?.Pitch?.ToString?.() ?? rec?.pitch?.ToString?.() ?? '?';
}

async function inspect(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawMeasureNumbers: true,
    useXMLMeasureNumbers: true,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);

  try {
    await osmd.load(xml);
  } catch (e) {
    console.log(label, 'LOAD FAIL', e instanceof Error ? e.message : e);
    return;
  }
  osmd.zoom = 0.4;
  osmd.render();

  const sheetRaw = osmd as unknown as Record<string, unknown>;
  const sheet = (sheetRaw.Sheet ?? sheetRaw.sheet) as {
    SourceMeasures?: Array<{
      MeasureNumber?: number;
      measureNumber?: number;
      VerticalSourceStaffEntryContainers?: Array<{
        StaffEntries?: Array<{ graphNotes?: unknown[]; notes?: unknown[] } | null>;
      }>;
    }>;
  };

  console.log(`\n=== ${label} ===`);
  for (const sm of sheet?.SourceMeasures ?? []) {
    const num = Number(sm.MeasureNumber ?? sm.measureNumber ?? 0);
    if (num < 25 || num > 27) continue;
    const pitches: string[] = [];
    for (const vc of sm.VerticalSourceStaffEntryContainers ?? []) {
      for (const se of vc.StaffEntries ?? []) {
        if (!se) continue;
        for (const gn of se.graphNotes ?? se.notes ?? []) {
          pitches.push(pitchFromSourceNote(gn));
        }
      }
    }
    console.log(`source m${num}`, pitches.slice(0, 20));
  }

  const graphic = (sheetRaw.GraphicSheet ?? sheetRaw.graphic) as {
    MeasureList?: Array<{ MeasureNumber?: number; measureNumber?: number }>;
  };
  const nums = new Set<number>();
  for (const gm of graphic?.MeasureList ?? []) {
    nums.add(Number(gm.MeasureNumber ?? gm.measureNumber ?? 0));
  }
  console.log('graphic measure numbers 24-28', [24, 25, 26, 27, 28].map((n) => (nums.has(n) ? n : `${n}?`)));
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const cleaned = repairTimelineForOsmdPreview(raw);
  await inspect('RAW (with dangling backup)', raw);
  await inspect('CLEANED (repairTimeline)', cleaned);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
