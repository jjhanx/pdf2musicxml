/** OSMD m17: SVG notehead X positions with/without VoiceSpacing=0 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

async function render(label: string, tweak?: (r: Record<string, unknown>) => void) {
  const xml = fs.readFileSync('_smoke/_m17_p5_only.xml', 'utf8');
  const host = document.getElementById('h')!;
  host.innerHTML = '';
  host.style.width = '1200px';
  host.style.height = '500px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  const rules = (osmd as { EngravingRules: Record<string, unknown> }).EngravingRules;
  if (tweak) tweak(rules);
  await (osmd as { load: (x: string) => Promise<void> }).load(xml);
  (osmd as { render: () => void }).render();

  const notes = [...host.querySelectorAll('.vf-stavenote')];
  const rows: { x: number; y: number; cls: string }[] = [];
  for (const n of notes) {
    const bb = (n as SVGGraphicsElement).getBBox?.();
    const tr = n.getAttribute('transform') ?? '';
    const m = /translate\(\s*([-\d.]+)\s*,?\s*([-\d.]+)?/.exec(tr);
    const x = bb ? bb.x + bb.width / 2 : m ? parseFloat(m[1]!) : NaN;
    const y = bb ? bb.y : m ? parseFloat(m[2] ?? '0') : NaN;
    rows.push({ x: Math.round(x), y: Math.round(y), cls: n.className.baseVal ?? '' });
  }
  rows.sort((a, b) => a.x - b.x || a.y - b.y);
  console.log(`\n${label} mult=${rules.VoiceSpacingMultiplierVexflow} add=${rules.VoiceSpacingAddendVexflow} notes=${notes.length}`);
  console.log(rows.slice(0, 12));
  if (rows.length >= 4) {
    const xs = rows.map((r) => r.x);
    const unique = [...new Set(xs)];
    console.log('unique X count', unique.length, unique.slice(0, 8));
    // first cluster around E5/F4 (x ~232 in XML) — notes 2 and 3 in timeline
    const cluster = rows.filter((r) => r.x > 100 && r.x < 400);
    console.log('mid cluster', cluster);
    if (cluster.length >= 2) {
      const minX = Math.min(...cluster.map((c) => c.x));
      const maxX = Math.max(...cluster.map((c) => c.x));
      console.log('mid cluster spread', maxX - minX);
    }
  }
}

async function main() {
  if (!fs.existsSync('_smoke/_m17_p5_only.xml')) {
    execSync('npx tsx _smoke/test_m17_osmd_slice.ts', { stdio: 'inherit' });
  }
  await render('default');
  await render('voice spacing 0', (r) => {
    r.VoiceSpacingMultiplierVexflow = 0;
    r.VoiceSpacingAddendVexflow = 0;
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
