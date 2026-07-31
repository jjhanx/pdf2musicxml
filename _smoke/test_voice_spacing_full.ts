/** Test VoiceSpacing=0 on full 0ea5 preview vs m17 slice. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h" style="width:1400px;height:900px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

async function loadXml(label: string, xml: string, zeroSpacing: boolean) {
  const host = document.getElementById('h')!;
  host.innerHTML = '';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  const rules = (osmd as { EngravingRules: Record<string, unknown> }).EngravingRules;
  if (zeroSpacing) {
    rules.VoiceSpacingMultiplierVexflow = 0;
    rules.VoiceSpacingAddendVexflow = 0;
  }
  try {
    await (osmd as { load: (x: string) => Promise<void> }).load(xml);
    (osmd as { render: () => void }).render();
    const svg = host.querySelector('svg');
    const w = svg?.getAttribute('width') ?? '?';
    const notes = svg?.querySelectorAll('.vf-stavenote').length ?? 0;
    console.log('OK', label, 'spacing0=', zeroSpacing, 'svgW=', w, 'notes=', notes);
    return true;
  } catch (e) {
    console.log('FAIL', label, 'spacing0=', zeroSpacing, e);
    return false;
  }
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) { console.log('skip'); return; }
  const slice = fs.readFileSync('_smoke/_m17_p5_only.xml', 'utf8');
  await loadXml('m17 slice', slice, false);
  await loadXml('m17 slice', slice, true);

  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  fs.writeFileSync('_smoke/_tmp_full_raw.xml', raw);
  // minimal: first 20 measures P5 only to speed up
  const doc = new DOMParser().parseFromString(raw, 'text/xml');
  const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const measures = [...part.children].filter((c) => local(c as Element) === 'measure').slice(0, 25);
  const mini = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list><part id="P5">${measures.map((m) => (m as Element).outerHTML).join('')}</part></score-partwise>`;
  await loadXml('P5 m1-25 raw', mini, false);
  await loadXml('P5 m1-25 raw', mini, true);
}

main();
