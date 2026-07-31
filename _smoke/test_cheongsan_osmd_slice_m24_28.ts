/**
 * OSMD m24-28 slice — isolate m26 shift without full-score load errors.
 * Run: npx tsx _smoke/test_cheongsan_osmd_slice_m24_28.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  countDanglingTimelineElements,
} from '../shared/musicXmlTimelineCleanup.ts';

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:1200px;height:2000px"></div></body></html>',
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

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function sliceMeasures(xml: string, from: number, to: number): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  const partList = [...root.children].find((c) => local(c) === 'part-list');
  if (partList) {
    for (const sp of [...partList.children]) {
      if (local(sp) !== 'score-part') continue;
      const id = sp.getAttribute('id') ?? '';
      if (!/^P[1-5]$/.test(id)) continue;
    }
  }
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '';
    if (!/^P[1-5]$/.test(pid)) continue;
    for (const child of [...part.children]) {
      if (local(child) !== 'measure') continue;
      const n = parseInt(child.getAttribute('number') ?? '0', 10);
      if (n < from || n > to) part.removeChild(child);
    }
  }
  const body = new XMLSerializer().serializeToString(doc);
  return body.startsWith('<?xml') ? body : `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

function pitchSummary(xml: string, mnum: number): Record<string, string[]> {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out: Record<string, string[]> = {};
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '';
    if (!/^P[1-5]/.test(pid)) continue;
    const meas = [...part.children].find(
      (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === String(mnum),
    ) as Element | undefined;
    if (!meas) continue;
    const pitches: string[] = [];
    for (const c of [...meas.children]) {
      if (local(c) !== 'note') continue;
      const p = c.querySelector('pitch, *|pitch');
      pitches.push(
        p
          ? `${p.querySelector('step, *|step')?.textContent ?? '?'}${p.querySelector('octave, *|octave')?.textContent ?? ''}`
          : 'R',
      );
    }
    out[pid] = pitches;
  }
  return out;
}

type GraphicNote = { pitch?: string; measure?: number };

function graphicPitchesByMeasure(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mnum: number): GraphicNote[] {
  const out: GraphicNote[] = [];
  const sheet = osmd.GraphicSheet as {
    MeasureList?: Array<{
      MeasureNumber?: number;
      measureNumber?: number;
      staffEntries?: Array<{ graphNotes?: Array<{ sourceNote?: { Pitch?: { ToString?: () => string }; pitch?: unknown } }> }>;
    }>;
  };
  for (const m of sheet?.MeasureList ?? []) {
    const num = Number(m.MeasureNumber ?? m.measureNumber ?? 0);
    if (num !== mnum) continue;
    for (const se of m.staffEntries ?? []) {
      for (const gn of se.graphNotes ?? []) {
        const src = gn.sourceNote as { Pitch?: { ToString?: () => string } } | undefined;
        const pitch = src?.Pitch?.ToString?.() ?? '?';
        out.push({ pitch, measure: num });
      }
    }
  }
  return out;
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  console.log('raw dangling', countDanglingTimelineElements(raw));
  const cleaned = repairTimelineForOsmdPreview(raw);
  console.log('cleaned dangling', countDanglingTimelineElements(cleaned));
  for (const n of [25, 26, 27]) {
    console.log(`xml m${n}`, pitchSummary(cleaned, n));
  }

  const slice = sliceMeasures(cleaned, 24, 28);
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawMeasureNumbers: true,
    useXMLMeasureNumbers: true,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);

  await osmd.load(slice);
  osmd.zoom = 0.55;
  osmd.render();

  for (const n of [24, 25, 26, 27, 28]) {
    const notes = graphicPitchesByMeasure(osmd, n);
    console.log(`graphic m${n}`, notes.map((x) => x.pitch).slice(0, 12));
  }

  const m26 = graphicPitchesByMeasure(osmd, 26);
  const m27 = graphicPitchesByMeasure(osmd, 27);
  const m26HasF5 = m26.some((n) => String(n.pitch).includes('F') && String(n.pitch).includes('5'));
  const m27HasB4 = m27.some((n) => String(n.pitch).includes('B') && String(n.pitch).includes('4'));
  if (!m26HasF5) {
    throw new Error(`OSMD m26 missing P1 F5 — got ${JSON.stringify(m26.map((x) => x.pitch))}`);
  }
  if (m26.some((n) => String(n.pitch).includes('B') && String(n.pitch).includes('4'))) {
    throw new Error('OSMD m26 contains m27 B4 pitches (shift detected)');
  }
  console.log('slice m26 ok', { m26Count: m26.length, m27HasB4 });
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
