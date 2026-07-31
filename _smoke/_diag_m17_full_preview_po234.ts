/**
 * Full UI preview path: buildOsmdPreviewXml(PR) + m17 po 2/3/4 default-x.
 * Run: npx tsx _smoke/_diag_m17_full_preview_po234.ts
 */
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { buildOsmdPreviewXml } from '../src/AudiverisInspectPanel';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
};

const raw = execSync('python _smoke/_export_m17_play_order_234.py', { encoding: 'utf8', maxBuffer: 30e6 });
const preview = buildOsmdPreviewXml(
  raw,
  [{ id: 'P5', displayLabel: 'PR', suggestedLabel: 'PR', partIndex: 4 }],
  { partId: 'P5', label: 'PR', staffWithinPart: 1 },
  { verbatim: true },
);

const doc = new DOMParser().parseFromString(preview, 'text/xml');
const part = [...doc.querySelectorAll('part,*|part')].find((p) => (p.getAttribute('id') ?? '').startsWith('P5'))!;
console.log('part id', part.getAttribute('id'));
const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
const attrs = [...m17.children].find((c) => local(c) === 'attributes');
console.log('attrs', attrs?.innerHTML?.slice(0, 300));

for (const c of [...m17.children]) {
  if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
  console.log({
    pitch: pitch(c),
    v: c.querySelector('voice,*|voice')?.textContent,
    po: c.getAttribute('data-hitl-play-order'),
    x: c.getAttribute('default-x'),
    type: c.querySelector('type,*|type')?.textContent,
    print: c.getAttribute('print-object'),
  });
}
