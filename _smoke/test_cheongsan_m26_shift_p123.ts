/**
 * Reproduce m26→m27 shift with loadable part combo (P1+P2+P3).
 * Run: npx tsx _smoke/test_cheongsan_m26_shift_p123.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  countDanglingTimelineElements,
} from '../shared/musicXmlTimelineCleanup.ts';
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

function prep(xml: string, partIds: string[], maxMeasure: number, cleanup: boolean): string {
  let out = xml;
  if (cleanup) {
    out = repairRestDisplayForOsmdPreview(out);
    out = repairTimelineForOsmdPreview(out);
  }
  const doc = parseMusicXmlDocument(out);
  if (!doc) throw new Error('parse');
  const keep = new Set(partIds);
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '';
    if (!keep.has(pid)) {
      part.parentNode?.removeChild(part);
      continue;
    }
    for (const child of [...part.children]) {
      if (local(child) !== 'measure') continue;
      const n = parseInt(child.getAttribute('number') ?? '0', 10);
      if (n > maxMeasure) part.removeChild(child);
    }
  }
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  if (partList) {
    for (const sp of [...partList.children]) {
      if (local(sp) !== 'score-part') continue;
      if (!keep.has(sp.getAttribute('id') ?? '')) partList.removeChild(sp);
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

function sourcePitches(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mnum: number): string[] {
  const sheetRaw = osmd as unknown as Record<string, unknown>;
  const sheet = (sheetRaw.Sheet ?? sheetRaw.sheet) as {
    SourceMeasures?: Array<Record<string, unknown>>;
  };
  const out: string[] = [];
  for (const sm of sheet?.SourceMeasures ?? []) {
    const num = Number(sm.MeasureNumber ?? sm.measureNumber ?? sm.MeasureNumberXML ?? 0);
    if (num !== mnum) continue;
    const vc = (sm.VerticalSourceStaffEntryContainers ?? sm.verticalSourceStaffEntryContainers) as
      | Array<Record<string, unknown>>
      | undefined;
    for (const container of vc ?? []) {
      const entries = (container.StaffEntries ?? container.staffEntries) as Array<Record<string, unknown> | null> | undefined;
      for (const se of entries ?? []) {
        if (!se) continue;
        const notes = (se.graphNotes ?? se.notes ?? se.GraphicalNotes) as unknown[] | undefined;
        for (const gn of notes ?? []) {
          const rec = gn as Record<string, unknown>;
          const pitch = rec.Pitch ?? rec.pitch;
          const pRec = pitch as { ToString?: () => string; fundamentalNote?: unknown } | undefined;
          out.push(pRec?.ToString?.() ?? String(pRec?.fundamentalNote ?? '?'));
        }
      }
    }
  }
  return out;
}

async function runCase(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawMeasureNumbers: true,
    useXMLMeasureNumbers: true,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.zoom = 0.55;
  osmd.render();
  const m26 = sourcePitches(osmd, 26);
  const m27 = sourcePitches(osmd, 27);
  console.log(label, { m26, m27 });
  const m26HasF5 = m26.some((p) => p.includes('F') && p.includes('5'));
  const m26HasB4 = m26.some((p) => p.includes('B') && p.includes('4'));
  const shift = !m26HasF5 && m26HasB4;
  if (shift) throw new Error(`${label}: m26 shifted — got ${JSON.stringify(m26)}`);
  if (!m26HasF5 && m26.length === 0) throw new Error(`${label}: m26 empty`);
  return { m26, m27 };
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  console.log('dangling in raw', countDanglingTimelineElements(raw));
  const parts = ['P1', 'P2', 'P3'];
  const maxMeasure = 28;

  const rawSlice = prep(raw, parts, maxMeasure, false);
  const cleanSlice = prep(raw, parts, maxMeasure, true);
  writeFileSync('_smoke/_cheongsan_p123_m24_28_raw.xml', rawSlice, 'utf8');
  writeFileSync('_smoke/_cheongsan_p123_m24_28_clean.xml', cleanSlice, 'utf8');

  await runCase('RAW no cleanup', rawSlice);
  await runCase('CLEANED repairTimeline', cleanSlice);
  console.log('m26 shift test ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
