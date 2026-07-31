/**
 * Simulates buildOsmdPreviewXml PR filter path + OSMD graphic X for m17.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const OpenSheetMusicDisplay =
  (osmdLib as { OpenSheetMusicDisplay?: typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay })
    .OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay } })
    .default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function measureHasLeadingForward(measure: Element): boolean {
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'forward') return true;
    if (tag === 'note') return false;
  }
  return false;
}

function buildPrPreview(rawXml: string): string {
  let xml = repairTimelineForOsmdPreview(rawXml);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P5');
  if (!part) throw new Error('P5 missing');
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (local(child) === 'note') {
        const st = child.querySelector('staff, *|staff')?.textContent?.trim();
        if (st && st !== '1') child.remove();
      }
    }
    measure.querySelectorAll('note staff, note *|staff').forEach((el) => { el.textContent = '1'; });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    if (!measureHasLeadingForward(measure)) {
      // flatten skipped when leading forward — same as AudiverisInspectPanel
    }
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  xml = new XMLSerializer().serializeToString(doc);
  return repairTimelineForOsmdPreview(xml);
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) { console.log('skip'); return; }
  const rawXml = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const preview = buildPrPreview(rawXml);
  fs.writeFileSync('_smoke/_m17_pr_preview.xml', preview);

  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const part = [...doc.querySelectorAll('part, *|part')][0];
  const m17 = [...part!.children].find((c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17') as Element;
  console.log('m17 XML:');
  for (const c of [...m17.children].slice(0, 8)) {
    const tag = local(c);
    if (tag === 'note') {
      console.log(`  ${c.querySelector('step,*|step')?.textContent}${c.querySelector('octave,*|octave')?.textContent} x=${c.getAttribute('default-x')} v=${c.querySelector('voice,*|voice')?.textContent}`);
    } else if (tag === 'forward') console.log(`  forward v=${c.querySelector('voice,*|voice')?.textContent}`);
  }

  const host = document.getElementById('host')!;
  const osmd = new OpenSheetMusicDisplay!(host, { autoResize: false, backend: 'svg' });
  await osmd.load(preview);
  osmd.render();

  const sheet = (osmd as unknown as { graphic?: { MeasureList?: unknown[] } }).graphic;
  const measures = (sheet?.MeasureList ?? []) as Record<string, unknown>[];
  const m = measures.find((x) => Number(x.MeasureNumber ?? x.measureNumber ?? 0) === 17);
  const xs: Record<string, number[]> = {};
  const staffEntries = ((m?.staffEntries ?? m?.StaffEntries ?? []) as Record<string, unknown>[]);
  for (const se of staffEntries) {
    const pos = (se.PositionAndShape ?? se.positionAndShape) as Record<string, unknown> | undefined;
    const rel = (pos?.RelativePosition ?? pos?.relativePosition) as Record<string, unknown> | undefined;
    const x = Number(rel?.x ?? rel?.X ?? NaN);
    for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
      for (const n of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
        const src = (n.sourceNote ?? n.SourceNote ?? n) as Record<string, unknown>;
        const pitch = src.Pitch ?? src.pitch;
        if (pitch && typeof pitch === 'object') {
          const p = pitch as Record<string, unknown>;
          const label = String(p.FundamentalNote ?? p.fundamentalNote) + String(p.Octave ?? p.octave);
          (xs[label] ??= []).push(x);
        }
      }
    }
  }
  console.log('OSMD X:', xs);
  const f4x = xs.F4?.[0], e5x = xs.E5?.[0];
  if (f4x == null || e5x == null) throw new Error('missing notes');
  console.log('delta', f4x - e5x);
  if (Math.abs(f4x - e5x) > 0.05) throw new Error(`MISALIGN F4=${f4x} E5=${e5x}`);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
