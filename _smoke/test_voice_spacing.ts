import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import fs from 'fs';

const OSMD = (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay
  ?? (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h" style="width:900px;height:400px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, Node: dom.window.Node, Element: dom.window.Element,
  DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

async function testRules(label: string, tweak?: (r: Record<string, unknown>) => void) {
  const xml = fs.readFileSync('_smoke/_m17_p5_only.xml', 'utf8');
  const host = document.getElementById('h')!;
  host.innerHTML = '';
  const osmd = new OSMD!(host, { autoResize: false, backend: 'svg' });
  const rules = (osmd as { EngravingRules: Record<string, unknown> }).EngravingRules;
  if (tweak) tweak(rules);
  await (osmd as { load: (x: string) => Promise<void> }).load(xml);
  (osmd as { render: () => void }).render();
  const svg = host.querySelector('svg');
  const notes = [...(svg?.querySelectorAll('.vf-stavenote') ?? [])];
  console.log(label, 'mult=', rules.VoiceSpacingMultiplierVexflow, 'add=', rules.VoiceSpacingAddendVexflow, 'notes=', notes.length);
  const xs: number[] = [];
  svg?.querySelectorAll('.vf-stavenote').forEach((n) => {
    const tr = n.getAttribute('transform') ?? n.closest('[transform]')?.getAttribute('transform') ?? '';
    const m = /translate\(\s*([-\d.]+)/.exec(tr);
    if (m) xs.push(Math.round(parseFloat(m[1]!)));
  });
  console.log('  translate xs', xs.slice(0, 10));
}

async function main() {
  await testRules('default');
  await testRules('zero voice spacing', (r) => {
    r.VoiceSpacingMultiplierVexflow = 0;
    r.VoiceSpacingAddendVexflow = 0;
  });
}

main().catch(console.error);
