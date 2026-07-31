/** m17 preview without voice merge — OSMD load + graphic X + beam check */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

async function main() {
  const { buildOsmdPreviewXml } = await import('../src/AudiverisInspectPanel.tsx');
  const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const preview = buildOsmdPreviewXml(raw, [{ id: 'P5', displayLabel: 'PR', suggestedLabel: 'PR', partIndex: 4 }], {
    partId: 'P5', staffWithinPart: 1, label: 'PR',
  }, { verbatim: true });
  fs.writeFileSync('_smoke/_m17_no_merge_preview.xml', preview);

  const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find(p => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find(c => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  console.log('m17 notes (no merge path):');
  for (const c of [...m17.children]) {
    if (local(c) !== 'note') continue;
    const step = c.querySelector('step,*|step')?.textContent;
    const oct = c.querySelector('octave,*|octave')?.textContent;
    const ch = c.querySelector('chord,*|chord') ? '*' : '';
    console.log(`  ${step}${oct}${ch} type=${c.querySelector('type,*|type')?.textContent} beam=${c.querySelector('beam,*|beam')?.textContent ?? ''} x=${c.getAttribute('default-x')} v=${c.querySelector('voice,*|voice')?.textContent}`);
  }

  const host = document.getElementById('h')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();

  const e5 = [...host.querySelectorAll('.vf-stavenote')].find(n => {
    const stem = n.querySelector('.vf-stem');
    return stem && n.getBBox().height > 20;
  });
  console.log('stavenotes', host.querySelectorAll('.vf-stavenote').length);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
