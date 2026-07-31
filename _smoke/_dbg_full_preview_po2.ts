/**
 * Full buildOsmdPreviewXml path for m17 play order 2 vanish check.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

async function main() {
  const { buildOsmdPreviewXml } = await import('../src/AudiverisInspectPanel.tsx');
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const preview = buildOsmdPreviewXml(raw, [{ id: 'P5', displayLabel: 'PR' }] as never, {
    partId: 'P5',
    staffWithinPart: 1,
    label: 'PR',
  }, { verbatim: true });

  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const m17 = [...doc.querySelectorAll('part[id="P5"] > measure')].find((m) => m.getAttribute('number') === '17')!;
  const leaders: string[] = [];
  for (const n of [...m17.children]) {
    if (n.localName !== 'note' || n.querySelector('chord,*|chord')) continue;
    const step = n.querySelector('step,*|step')?.textContent;
    const oct = n.querySelector('octave,*|octave')?.textContent;
    leaders.push(`${step}${oct}`);
  }
  console.log('xml leaders', leaders.join(' '));

  const host = document.getElementById('host')!;
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();
  console.log('stavenotes', host.querySelectorAll('.vf-stavenote,.vf-staveNote').length);
  console.log('noteheads', host.querySelectorAll('.vf-notehead').length);
}

main().catch(console.error);
