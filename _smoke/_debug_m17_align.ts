/** Debug m17 vs m16: hints + OSMD graphic voice/onset/x before/after align */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  collectLinkedParallelOnsetHintsFromXml,
  repairTimelineForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { alignLinkedParallelOnsetGraphics } from '../src/osmdLinkedParallelAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from '../src/osmdMeasureClick';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  Node: dom.window.Node, Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const r = asRec(v);
  if (!r) return null;
  if (typeof r.realValue === 'number') return r.realValue;
  if (typeof r.RealValue === 'number') return r.RealValue;
  return null;
}

function dumpGraphic(osmd: unknown, mn: number, label: string) {
  console.log(`\n=== ${label} m${mn} ===`);
  forEachGraphicalMeasure(osmd as never, (gm) => {
    if (measureMxlFromGraphic(gm) !== mn) return;
    const g = asRec(gm)!;
    for (const se of (g.staffEntries ?? g.StaffEntries ?? []) as unknown[]) {
      const er = asRec(se)!;
      for (const gveRaw of (er.graphicalVoiceEntries ?? er.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gve = asRec(gveRaw)!;
        const pve = asRec(gve.parentVoiceEntry ?? gve.ParentVoiceEntry);
        const ts = num(pve?.Timestamp ?? pve?.timestamp);
        const pos = asRec(gve.PositionAndShape ?? gve.positionAndShape);
        const rel = asRec(pos?.RelativePosition ?? pos?.relativePosition);
        const x = num(rel?.x ?? rel?.X);
        const notes = (gve.notes ?? gve.Notes) as unknown[];
        const pitches: string[] = [];
        for (const n of notes ?? []) {
          const src = asRec(asRec(n)?.sourceNote ?? asRec(n)?.SourceNote);
          const pitch = asRec(src?.Pitch ?? src?.pitch);
          const fn = Number(pitch?.FundamentalNote ?? pitch?.fundamentalNote);
          const oct = Number(pitch?.Octave ?? pitch?.octave);
          const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
          if (Number.isFinite(fn) && Number.isFinite(oct)) pitches.push(`${names[fn] ?? fn}${oct}`);
        }
        console.log(`  ts=${ts} x=${x?.toFixed(3)} pitches=${pitches.join('+')}`);
      }
    }
  });
}

async function runPreview(raw: string, label: string) {
  const { buildOsmdPreviewXml } = await import('../src/AudiverisInspectPanel.tsx');
  const preview = buildOsmdPreviewXml(
    raw,
    [{ id: 'P5', displayLabel: 'PR', suggestedLabel: 'PR', partIndex: 4 }],
    null,
    { verbatim: true },
  );
  const hints = collectLinkedParallelOnsetHintsFromXml(preview);
  console.log(`\n${label} hints:`, hints.filter((h) => h.measureNumber === 16 || h.measureNumber === 17));

  const host = document.getElementById('h')!;
  host.innerHTML = '';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  dumpGraphic(osmd, 17, `${label} BEFORE align`);
  alignLinkedParallelOnsetGraphics(osmd, hints);
  dumpGraphic(osmd, 17, `${label} AFTER align`);
  (osmd as { render: () => void }).render();
  return hints;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) { console.log('skip'); return; }

  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const out = join(tmpdir(), '0ea5_review.xml');
  execSync(`python -c "import io,zipfile;z=zipfile.ZipFile('omr-work-0ea5ea52.zip');d=z.read('review.mxl');inner=zipfile.ZipFile(io.BytesIO(d));x=[n for n in inner.namelist() if n.endswith('.xml') and 'META' not in n.upper()][0];open(r'${out.replace(/\\/g, '\\\\')}', 'wb').write(inner.read(x))"`, { cwd: process.cwd(), stdio: 'pipe' });
  const review = fs.readFileSync(out, 'utf8');

  const m17raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  await runPreview(repairTimelineForOsmdPreview(review), 'review');
  await runPreview(repairTimelineForOsmdPreview(m17raw), 'm17fix');
}

main().catch((e) => { console.error(e); process.exit(1); });
