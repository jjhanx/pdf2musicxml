/**
 * Bisect HITL preview pipeline — find step that shifts m27 into m26 column.
 * Run: npx tsx _smoke/bisect_m26_shift_full.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import {
  buildOsmdPreviewXml,
  splitGrandStaffPartsForFullScoreOsmd,
} from '../src/AudiverisInspectPanel.tsx';
import { repairTimelineForOsmdPreview, countDanglingTimelineElements } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { measureMxlFromGraphic, forEachOsmdSystem, partIdFromGraphic } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:2400px;height:14000px"></div></body></html>');
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

const SCORE_PARTS = [
  { id: 'P1', displayLabel: 'S' },
  { id: 'P2', displayLabel: 'A' },
  { id: 'P3', displayLabel: 'T' },
  { id: 'P4', displayLabel: 'B' },
  { id: 'P5', displayLabel: 'P' },
];

function osmdPitchToken(p: Record<string, unknown>): string {
  return `fn${p.FundamentalNote}/oct${p.Octave}`;
}

function p1Tokens(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mn: number): string[] {
  const out: string[] = [];
  const sheet = (osmd as unknown as { Sheet?: { SourceMeasures?: Array<Record<string, unknown>> } }).Sheet;
  for (const sm of sheet?.SourceMeasures ?? []) {
    if (Number(sm.MeasureNumberXML ?? sm.MeasureNumber) !== mn) continue;
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      for (const se of ((c as Record<string, unknown>).StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        const inst = (se as Record<string, unknown>).ParentStaff as Record<string, unknown> | undefined;
        const instr = inst?.ParentInstrument as Record<string, unknown> | undefined;
        if (String(instr?.IdString ?? '') !== 'P1') continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          for (const n of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            const p = (n as Record<string, unknown>).Pitch as Record<string, unknown> | undefined;
            if (p) out.push(osmdPitchToken(p));
          }
        }
      }
    }
  }
  return out;
}

function graphicMxlMap(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, pid: string): Map<number, string | null> {
  const m = new Map<number, string | null>();
  forEachOsmdSystem(osmd, (_s, rows) => {
    for (const gm of rows[0] ?? []) {
      if (!gm) continue;
      if (partIdFromGraphic(gm as Record<string, unknown>) !== pid) continue;
      const n = measureMxlFromGraphic(gm as Record<string, unknown>);
      if (n == null) continue;
      const entries = (gm as Record<string, unknown>).staffEntries ?? (gm as Record<string, unknown>).StaffEntries;
      let tok: string | null = null;
      for (const entry of (entries as unknown[]) ?? []) {
        const er = entry as Record<string, unknown>;
        const gves = (er.graphicalVoiceEntries ?? er.GraphicalVoiceEntries) as unknown[] | undefined;
        for (const gve of gves ?? []) {
          const gr = gve as Record<string, unknown>;
          const notes = (gr.notes ?? gr.Notes) as unknown[] | undefined;
          for (const note of notes ?? []) {
            const nr = note as Record<string, unknown>;
            const src = (nr.sourceNote ?? nr.SourceNote) as Record<string, unknown> | undefined;
            const p = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
            if (p) { tok = osmdPitchToken(p); break; }
          }
          if (tok) break;
        }
        if (tok) break;
      }
      m.set(n, tok);
    }
  });
  return m;
}

async function check(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(xml);
  osmd.zoom = 0.35;
  osmd.render();
  const m26 = p1Tokens(osmd, 26);
  const m27 = p1Tokens(osmd, 27);
  const g = graphicMxlMap(osmd, 'P1');
  const g26 = g.get(26) ?? null;
  const g27 = g.get(27) ?? null;
  const shifted = m26.length > 0 && m27.length > 0 && JSON.stringify(m26) === JSON.stringify(m27);
  const m26empty = m26.length === 0;
  const m27in26col = g26 != null && g27 != null && g26 === g27;
  console.log(label, { srcM26: m26.slice(0, 4), srcM27: m27.slice(0, 4), g26, g27, m26empty, m27in26col, shifted });
  if (m26empty || m27in26col || (m26[0] && m27[0] && m26[0] === m27[0] && m26[1] === m27[1])) {
    throw new Error(`${label}: m26/m27 shift detected`);
  }
}

async function main() {
  const raw = readFileSync('_smoke/_raw_cheongsan.xml', 'utf8');
  console.log('dangling raw', countDanglingTimelineElements(raw));

  await check('0 raw xml', raw);

  let s = raw;
  s = buildOsmdPreviewXml(raw, SCORE_PARTS, null, { verbatim: true });
  await check('1 buildOsmdPreviewXml', s);

  s = repairRestDisplayForOsmdPreview(s);
  await check('2 + repairRestDisplay', s);

  s = repairMissingNoteTypesForOsmdPreview(s);
  await check('3 + repairMissingNoteTypes', s);

  s = repairTimelineForOsmdPreview(s);
  await check('4 + repairTimeline (2nd)', s);

  s = repairUnderfullMeasuresForOsmdPreview(s);
  await check('5 + repairUnderfull', s);

  const doc = parseMusicXmlDocument(s);
  doc?.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  s = doc ? serializeMusicXmlDocument(doc) : s;
  await check('6 + strip octave-shift', s);

  console.log('bisect ok — no shift in pipeline');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
