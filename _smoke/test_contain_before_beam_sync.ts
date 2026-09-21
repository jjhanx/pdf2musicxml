/**
 * contain/clip must run BEFORE beam sync. Align-then-contain leaves Softmax hooks
 * on pre-contain tips so 16th hooks look stuck on the wrong stem after zoom.
 * Run: npx tsx _smoke/test_contain_before_beam_sync.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  syncVfStemsAndBeamsAfterStavenoteAlign,
} from '../src/osmdOnsetColumnAlignFix.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  Element: dom.window.Element,
  SVGElement: dom.window.SVGElement,
  HTMLElement: dom.window.HTMLElement,
});

const NS = 'http://www.w3.org/2000/svg';
const host = document.getElementById('host')!;

function beamRange(path: SVGPathElement): { left: number; right: number } {
  const xs = [...(path.getAttribute('d') || '').matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) =>
    parseFloat(m[1]!),
  );
  return { left: Math.min(...xs), right: Math.max(...xs) };
}

function addSN(measure: Element, stemX: number): SVGGraphicsElement {
  const sn = document.createElementNS(NS, 'g');
  sn.setAttribute('class', 'vf-stavenote');
  const stem = document.createElementNS(NS, 'g');
  stem.setAttribute('class', 'vf-stem');
  const sp = document.createElementNS(NS, 'path');
  sp.setAttribute('d', `M${stemX} 40L${stemX} 10`);
  stem.appendChild(sp);
  const head = document.createElementNS(NS, 'g');
  head.setAttribute('class', 'vf-notehead');
  const hp = document.createElementNS(NS, 'path');
  hp.setAttribute('d', `M${stemX - 5} 40L${stemX + 5} 40`);
  head.appendChild(hp);
  sn.appendChild(stem);
  sn.appendChild(head);
  measure.appendChild(sn);
  return sn as SVGGraphicsElement;
}

function addBeam(measure: Element, L: number, R: number, y: number): SVGPathElement {
  const b = document.createElementNS(NS, 'g');
  b.setAttribute('class', 'vf-beam');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', `M${L} ${y}L${R} ${y}L${R} ${y + 4}L${L} ${y + 4}Z`);
  b.appendChild(p);
  measure.appendChild(b);
  return p;
}

function shiftNote(sn: SVGGraphicsElement, dx: number) {
  sn.setAttribute('transform', `translate(${dx},0)`);
}

host.innerHTML = '';
const svg = document.createElementNS(NS, 'svg');
host.appendChild(svg);
const measure = document.createElementNS(NS, 'g');
measure.setAttribute('class', 'vf-measure');
svg.appendChild(measure);

// Softmax: 16th@100, dotted8@118, forward hook attached near 16th
const sn16 = addSN(measure, 100);
const sn8 = addSN(measure, 118);
addBeam(measure, 100, 118, 12);
const hook = addBeam(measure, 100, 108, 18);

// Correct order: contain (shift notes) THEN sync beams
shiftNote(sn16, 20);
shiftNote(sn8, 20);
syncVfStemsAndBeamsAfterStavenoteAlign(host);
const good = beamRange(hook);
assert.ok(
  Math.abs(good.left - 120) < 1.5 || Math.abs(good.right - 120) < 1.5,
  `contain→sync must attach hook to remeshed 16th@120, got ${good.left}..${good.right}`,
);

// Wrong order residual: sync first on Softmax, then contain without re-sync
host.innerHTML = '';
const svg2 = document.createElementNS(NS, 'svg');
host.appendChild(svg2);
const m2 = document.createElementNS(NS, 'g');
m2.setAttribute('class', 'vf-measure');
svg2.appendChild(m2);
const a16 = addSN(m2, 100);
const a8 = addSN(m2, 118);
addBeam(m2, 100, 118, 12);
const hook2 = addBeam(m2, 100, 108, 18);
syncVfStemsAndBeamsAfterStavenoteAlign(host); // attach at Softmax 100
shiftNote(a16, 20); // contain moves notes; beams stay
shiftNote(a8, 20);
const bad = beamRange(hook2);
assert.ok(
  Math.abs(bad.left - 100) < 1.5 || Math.abs(bad.right - 100) < 1.5,
  `align→contain without re-sync leaves hook at Softmax 100, got ${bad.left}..${bad.right}`,
);
assert.ok(
  Math.abs(bad.left - 120) > 5 && Math.abs(bad.right - 120) > 5,
  'stale Softmax hook must not sit on remeshed tip',
);

console.log('test_contain_before_beam_sync: OK', { good, bad });
