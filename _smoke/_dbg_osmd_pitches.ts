import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { dedupeSamePlayOrderPitchLayersForOsmdPreview } from '../shared/musicXmlPlayOrder';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

const STEP = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function pitchFromGn(gn: Record<string, unknown>): string {
  const src = (gn.sourceNote ?? gn.SourceNote) as Record<string, unknown> | undefined;
  const p = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
  if (!p) return '?';
  const fn = Number(p.FundamentalNote ?? p.fundamentalNote ?? 0);
  const oct = Number(p.Octave ?? p.octave ?? 0);
  const acc = (p.Accidental ?? p.accidental) === -1 ? 'b' : '';
  return `${STEP[fn] ?? '?'}${acc}${oct}`;
}

function buildM17(fixE5Onset: boolean): Element {
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => c.getAttribute('number') === '17') as Element;
  for (const child of [...m17.children]) {
    if (child.localName === 'note') {
      const st = child.querySelector('staff,*|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  m17.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  snapshotNoteDefaultXForOsmdPreview(m17);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  normalizeMultiVoiceLayersForOsmdPreview(m17);
  dedupeSamePlayOrderPitchLayersForOsmdPreview(m17);
  if (fixE5Onset) {
    for (const c of [...m17.children]) {
      if (c.localName !== 'note' || c.querySelector('chord,*|chord')) continue;
      const step = c.querySelector('step,*|step')?.textContent;
      const oct = c.querySelector('octave,*|octave')?.textContent;
      if (step === 'E' && oct === '5' && c.getAttribute('data-hitl-play-order') === '2') {
        c.setAttribute('data-osmd-onset-units', '1');
      }
    }
  }
  realignMeasureDefaultXFromTimelineForOsmd(m17);
  return m17;
}

async function osmdPitches(m17: Element, label: string): Promise<void> {
  const preview = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
  const host = document.getElementById('host')!;
  host.innerHTML = '';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();
  const pitches: string[] = [];
  const sheet = (osmd as { graphic?: { MeasureList?: Record<string, unknown>[] } }).graphic;
  for (const ml of sheet?.MeasureList ?? []) {
    if (Number(ml.MeasureNumber ?? ml.measureNumber) !== 17) continue;
    for (const se of (ml.staffEntries ?? ml.StaffEntries ?? []) as Record<string, unknown>[]) {
      for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
        for (const n of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
          pitches.push(pitchFromGn(n));
        }
      }
    }
  }
  console.log(label, 'pitches:', pitches.join(' '), 'stavenotes:', host.querySelectorAll('.vf-stavenote,.vf-staveNote').length);
}

async function main() {
  await osmdPitches(buildM17(false), 'broken');
  await osmdPitches(buildM17(true), 'E5 raw onset');
}

main().catch(console.error);
