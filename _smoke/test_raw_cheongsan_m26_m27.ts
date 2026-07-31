/**
 * Raw OMR (no score patches) — m26/m27 must both render in HITL preview pipeline.
 * Run: npx tsx _smoke/test_raw_cheongsan_m26_m27.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { buildOsmdPreviewXml } from '../src/AudiverisInspectPanel.tsx';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

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

function sanitizeLikePanel(xml: string): string {
  let out = repairRestDisplayForOsmdPreview(xml);
  out = repairMissingNoteTypesForOsmdPreview(out);
  out = repairTimelineForOsmdPreview(out);
  out = repairUnderfullMeasuresForOsmdPreview(out);
  const doc = parseMusicXmlDocument(out);
  doc?.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return doc ? serializeMusicXmlDocument(doc) : out;
}

function countNotes(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, partId: string, mn: number): number {
  let n = 0;
  const sheet = (osmd as unknown as { Sheet?: { SourceMeasures?: Array<Record<string, unknown>> } }).Sheet;
  for (const sm of sheet?.SourceMeasures ?? []) {
    if (Number(sm.MeasureNumberXML ?? sm.MeasureNumber) !== mn) continue;
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      for (const se of ((c as Record<string, unknown>).StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        const inst = (se as Record<string, unknown>).ParentStaff as Record<string, unknown> | undefined;
        const instr = inst?.ParentInstrument as Record<string, unknown> | undefined;
        if (String(instr?.IdString ?? '') !== partId) continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          n += (((ve as Record<string, unknown>).Notes as unknown[]) ?? []).length;
        }
      }
    }
  }
  return n;
}

async function main() {
  const rawPath = process.argv[2] ?? '_smoke/_raw_cheongsan.xml';
  const raw = readFileSync(rawPath, 'utf8');
  let xml = buildOsmdPreviewXml(raw, SCORE_PARTS, null, { verbatim: true });
  xml = sanitizeLikePanel(xml);

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(xml);
  osmd.zoom = 0.35;
  osmd.render();

  const parts = ['P1', 'P2', 'P3', 'P4', 'P5__PR', 'P5__PL'];
  for (const pid of parts) {
    const n26 = countNotes(osmd, pid, 26);
    const n27 = countNotes(osmd, pid, 27);
    console.log(pid, { m26: n26, m27: n27 });
    if (n27 === 0) throw new Error(`${pid} m27 empty on RAW OMR preview`);
  }
  console.log('raw cheongsan m26/m27 ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
