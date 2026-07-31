import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
const OSMD = (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay
  ?? (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, { document: dom.window.document, window: dom.window, requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; } });
async function main() {
  const host = document.getElementById('h')!;
  host.style.width = '900px';
  const xml = fs.readFileSync('_smoke/_m17_p5_only.xml', 'utf8');
  const osmd = new OSMD!(host, { autoResize: false, backend: 'svg' });
  await (osmd as { load: (x: string) => Promise<void> }).load(xml);
  (osmd as { render: () => void }).render();
  console.log('stavenotes', host.querySelectorAll('.vf-stavenote').length);
  console.log('inner len', host.innerHTML.length);
  for (const sn of host.querySelectorAll('.vf-stavenote')) {
    const tr = sn.getAttribute('transform');
    const paths = [...sn.querySelectorAll('.vf-notehead path')].map(p => p.getAttribute('d')?.slice(0,20));
    console.log('sn', tr, paths);
  }
}
main();
