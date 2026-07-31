/** Full score 0ea5 + VoiceSpacing=0 — does OSMD load/render? */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  Node: dom.window.Node, Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

async function load(label: string, zero: boolean) {
  const zip = 'omr-work-0ea5ea52.zip';
  if (!fs.existsSync(zip)) { console.log('skip'); return; }
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const out = join(tmpdir(), '0ea5.xml');
  execSync(`python -c "import io,zipfile;z=zipfile.ZipFile('${zip}');d=z.read('review.mxl');inner=zipfile.ZipFile(io.BytesIO(d));x=[n for n in inner.namelist() if n.endswith('.xml') and 'META' not in n.upper()][0];open(r'${out.replace(/\\/g, '\\\\')}', 'wb').write(inner.read(x))"`, { cwd: process.cwd(), stdio: 'pipe' });
  let xml = fs.readFileSync(out, 'utf8');
  xml = repairTimelineForOsmdPreview(xml);
  const host = document.getElementById('h')!;
  host.innerHTML = '';
  host.style.width = '1400px';
  host.style.height = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  const rules = (osmd as { EngravingRules: Record<string, unknown> }).EngravingRules;
  if (zero) { rules.VoiceSpacingMultiplierVexflow = 0; rules.VoiceSpacingAddendVexflow = 0; }
  try {
    await (osmd as { load: (x: string) => Promise<void> }).load(xml);
    (osmd as { render: () => void }).render();
    const n = host.querySelectorAll('.vf-stavenote').length;
    console.log('OK', label, 'notes=', n);
  } catch (e) {
    console.log('FAIL', label, e);
  }
}

async function main() {
  await load('full raw default spacing', false);
  await load('full raw voiceSpacing0', true);
}

main();
