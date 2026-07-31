/** Bisect OSMD load failure in m17 preview pipeline. */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';

const OpenSheetMusicDisplay =
  (osmdLib as { OpenSheetMusicDisplay?: typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay })
    .OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay } })
    .default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

async function tryLoad(label: string, xml: string) {
  const host = document.getElementById('h')!;
  const osmd = new OpenSheetMusicDisplay!(host, { autoResize: false, backend: 'svg' });
  try {
    await osmd.load(xml);
    console.log('OK', label);
    return true;
  } catch (e) {
    console.log('FAIL', label, e);
    return false;
  }
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  await tryLoad('raw fixed', raw);
  const repaired = repairTimelineForOsmdPreview(raw);
  await tryLoad('repairTimeline', repaired);
  if (fs.existsSync('_smoke/_m17_osmd_preview.xml')) {
    await tryLoad('full preview file', fs.readFileSync('_smoke/_m17_osmd_preview.xml', 'utf8'));
  }
}

main();
