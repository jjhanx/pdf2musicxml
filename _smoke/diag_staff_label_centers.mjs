#!/usr/bin/env node
/** OSMD StaffLine bbox vs SVG line Y — omr-work-82157d8d.zip 진단 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:900px"></div></body></html>',
);
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;

const xmlPath = path.join(__dirname, 'diag_82157_score.xml');
let xml = fs.readFileSync(xmlPath, 'utf-8');

// Apply same preview pipeline as app (labels + piano split)
const { applyPartLabelsToMusicXml, splitGrandStaffPartsForFullScoreOsmd, parseScoreParts } =
  await import('../src/AudiverisInspectPanel.ts');

const labels = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'omr-work-82157d8d.zip') ? '' : ''),
);
// load part labels from zip via python output - read part_labels from extracted json
const partLabelsJson = JSON.parse(
  await import('node:child_process').then(({ execSync }) =>
    execSync('python -c "import zipfile,json; z=zipfile.ZipFile(\'omr-work-82157d8d.zip\'); print(z.read(\'part_labels.json\').decode())"', {
      cwd: ROOT,
      encoding: 'utf-8',
    }),
  ),
);

const scoreParts = partLabelsJson.labels.map((label, i) => ({
  id: `P${i + 1}`,
  name: label,
  suggestedLabel: label,
  displayLabel: label,
}));

// Fix score part ids from xml
const doc = new DOMParser().parseFromString(xml, 'text/xml');
const ids = [...doc.querySelectorAll('part-list score-part, part-list *|score-part')].map((sp) =>
  sp.getAttribute('id'),
);
const scorePartsReal = ids.map((id, i) => ({
  id,
  name: partLabelsJson.labels[i] ?? id,
  suggestedLabel: partLabelsJson.labels[i] ?? id,
  displayLabel: partLabelsJson.labels[i] ?? id,
}));

xml = applyPartLabelsToMusicXml(xml, scorePartsReal);
xml = splitGrandStaffPartsForFullScoreOsmd(xml, scorePartsReal);

const host = document.getElementById('host');
const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
await osmd.load(xml);
osmd.zoom = 0.55;
osmd.render();

const { buildStaffLineCentersForSystem, forEachOsmdSystem, getOsmdPageLayout, partIdFromGraphic } =
  await import('../src/osmdMeasureClick.ts');

function svgStaffLineYs(hostEl, pageIndex) {
  const svgs = hostEl.querySelectorAll('svg');
  const svg = svgs[pageIndex] ?? svgs[0];
  if (!svg) return [];
  const lines = [...svg.querySelectorAll('line')].filter((ln) => {
    const x1 = Number(ln.getAttribute('x1'));
    const x2 = Number(ln.getAttribute('x2'));
    return Math.abs(x2 - x1) > 40;
  });
  const ys = lines.map((ln) => Number(ln.getAttribute('y1'))).filter((y) => Number.isFinite(y));
  ys.sort((a, b) => a - b);
  // cluster into staves (5 lines each, gap > 3)
  const staves = [];
  let cur = [];
  for (const y of ys) {
    if (!cur.length || y - cur[cur.length - 1] < 4) cur.push(y);
    else {
      if (cur.length >= 4) staves.push(cur);
      cur = [y];
    }
  }
  if (cur.length >= 4) staves.push(cur);
  return staves.map((s) => ({
    top: s[0],
    bottom: s[s.length - 1],
    center: (s[0] + s[s.length - 1]) / 2,
    n: s.length,
  }));
}

const hostRect = host.getBoundingClientRect();
const out = [];
forEachOsmdSystem(osmd, (system, rows, pageIndex) => {
  const layout = getOsmdPageLayout(host, osmd, pageIndex);
  const centers = buildStaffLineCentersForSystem(system, rows, layout);
  const svgStaves = svgStaffLineYs(host, pageIndex);
  out.push(`=== system page=${pageIndex} rows=${rows.length} svgStaves=${svgStaves.length} ===`);
  for (let si = 0; si < rows.length; si += 1) {
    const gm = rows[si]?.find((g) => g && !g.IsExtraGraphicalMeasure && !g.isExtraGraphicalMeasure);
    const pid = gm ? partIdFromGraphic(gm) : '?';
    const cy = centers[si];
    const svg = svgStaves[si];
    const svgCenterHost = svg
      ? layout.offsetY + svg.center * (layout.scale / (osmd.zoom || 1))
      : null;
    // also raw svg y in host coords via getBoundingClientRect on lines
    out.push(
      `  si=${si} part=${pid} center=${cy?.toFixed(1)} svgMid=${svg?.center?.toFixed(1)} svgHost~=${svgCenterHost?.toFixed(1)} delta=${cy != null && svgCenterHost != null ? (cy - svgCenterHost).toFixed(1) : '?'}`,
    );
  }
});
console.log(out.join('\n'));
