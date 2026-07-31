import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

async function tryLoad(path: string) {
  const xml = fs.readFileSync(path, 'utf8');
  const host = document.getElementById('h')!;
  host.innerHTML = '';
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg' });
  try {
    await (osmd as { load: (x: string) => Promise<void> }).load(xml);
    (osmd as { render: () => void }).render();
    console.log('OK', path, host.querySelectorAll('.vf-stavenote').length);
  } catch (e) {
    console.log('FAIL', path, e);
  }
}

async function main() {
  await tryLoad('_smoke/_m17_chord_beam_test.xml');
}

main();
