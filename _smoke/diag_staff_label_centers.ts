#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:920px"></div></body></html>');
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.SVGElement = dom.window.SVGElement;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle;

const labelsJson = JSON.parse(
  execSync('python -c "import zipfile,json; z=zipfile.ZipFile(\'omr-work-82157d8d.zip\'); print(z.read(\'part_labels.json\').decode())"', {
    cwd: ROOT,
    encoding: 'utf-8',
  }),
);

let xml = fs.readFileSync(path.join(__dirname, 'diag_82157_score.xml'), 'utf-8');
const {
  applyPartLabelsToMusicXml,
  splitGrandStaffPartsForFullScoreOsmd,
} = await import('../src/AudiverisInspectPanel.tsx');

const doc = new DOMParser().parseFromString(xml, 'text/xml');
const scoreParts = [...doc.querySelectorAll('part-list score-part, part-list *|score-part')].map((sp, i) => ({
  id: sp.getAttribute('id') ?? `P${i + 1}`,
  name: labelsJson.labelsByIndex?.[i] ?? sp.getAttribute('id') ?? '',
  suggestedLabel: labelsJson.labelsByIndex?.[i] ?? '',
  displayLabel: labelsJson.labelsByIndex?.[i] ?? '',
}));

xml = applyPartLabelsToMusicXml(xml, scoreParts);
xml = splitGrandStaffPartsForFullScoreOsmd(xml, scoreParts);

const host = document.getElementById('host')!;
const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
await osmd.load(xml);
osmd.zoom = 0.55;
osmd.render();

const {
  buildStaffLineCentersForSystem,
  forEachOsmdSystem,
  getOsmdPageLayout,
  partIdFromGraphic,
} = await import('../src/osmdMeasureClick.ts');

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function inspectStaffLine(sl: unknown): string {
  const r = asRec(sl);
  if (!r) return '?';
  const keys = Object.keys(r).filter((k) => /stave|staff|line|vf|vex|height|pos/i.test(k));
  const bits = keys.slice(0, 12).map((k) => `${k}=${String(r[k]).slice(0, 40)}`);
  const vf = r.vfStave ?? r.VfStave ?? r.stave ?? r.Stave;
  const vfr = asRec(vf);
  if (vfr && typeof vfr.getYForLine === 'function') {
    try {
      const y0 = (vfr.getYForLine as (n: number) => number)(0);
      const y2 = (vfr.getYForLine as (n: number) => number)(2);
      const y4 = (vfr.getYForLine as (n: number) => number)(4);
      bits.push(`vfY0=${y0} vfY2=${y2} vfY4=${y4}`);
    } catch {
      /* */
    }
  }
  return bits.join(' ');
}

function clusterStaffLineYs(ys: number[]): { center: number; top: number; bottom: number }[] {
  const sorted = [...ys].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const y of sorted) {
    const last = groups[groups.length - 1];
    if (!last || y - last[last.length - 1] > 5) groups.push([y]);
    else last.push(y);
  }
  return groups
    .filter((g) => g.length >= 4)
    .map((g) => ({ top: g[0], bottom: g[g.length - 1], center: (g[0] + g[g.length - 1]) / 2 }));
}

function svgStaffCentersInHost(hostEl: HTMLElement, pageIndex: number, layout: ReturnType<typeof getOsmdPageLayout>) {
  const svgs = hostEl.querySelectorAll('svg');
  const svg = svgs[pageIndex] ?? svgs[0];
  if (!svg) return [];
  const svgRect = svg.getBoundingClientRect();
  const hostRect = hostEl.getBoundingClientRect();
  const lines = [...svg.querySelectorAll('line')].filter((ln) => {
    const x1 = Number(ln.getAttribute('x1'));
    const x2 = Number(ln.getAttribute('x2'));
    return Math.abs(x2 - x1) > 50;
  });
  const ysHost = lines
    .map((ln) => {
      const r = ln.getBoundingClientRect();
      return r.top + r.height / 2 - hostRect.top;
    })
    .filter((y) => Number.isFinite(y));
  return clusterStaffLineYs(ysHost);
}

const lines: string[] = [];
forEachOsmdSystem(osmd, (system, rows, pageIndex) => {
  const layout = getOsmdPageLayout(host, osmd, pageIndex);
  const centers = buildStaffLineCentersForSystem(system, rows, layout);
  const svgCenters = svgStaffCentersInHost(host, pageIndex, layout);
  const staffLines = (system.StaffLines ?? system.staffLines) as unknown[] | undefined;
  lines.push(`=== page ${pageIndex} rows=${rows.length} staffLines=${staffLines?.length ?? 0} svgStaves=${svgCenters.length} ===`);
  for (let si = 0; si < rows.length; si += 1) {
    const gm = rows[si]?.find((g) => g && !(g as Record<string, unknown>).IsExtraGraphicalMeasure);
    const pid = gm ? partIdFromGraphic(gm as Record<string, unknown>) : '?';
    const cy = centers[si];
    const sc = svgCenters[si];
    const slInfo = staffLines?.[si] ? inspectStaffLine(staffLines[si]) : 'no-sl';
    lines.push(
      `  si=${si} ${pid} algoY=${cy?.toFixed(1) ?? '?'} svgY=${sc?.center.toFixed(1) ?? '?'} d=${cy != null && sc ? (cy - sc.center).toFixed(1) : '?'}`,
    );
    if (si < 2) lines.push(`    sl: ${slInfo}`);
  }
});
console.log(lines.join('\n'));
