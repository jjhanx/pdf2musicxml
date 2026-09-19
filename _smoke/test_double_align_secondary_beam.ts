/**
 * Double alignOsmdPreviewNotesByOnsetColumn must not stretch secondary beams
 * (2nd pass used to match Softmax naturalX against already-reshaped paths).
 * Run: npx tsx _smoke/test_double_align_secondary_beam.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { syncVfStemsAndBeamsAfterStavenoteAlign } from '../src/osmdOnsetColumnAlignFix';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  Element: dom.window.Element,
  SVGElement: dom.window.SVGElement,
  HTMLElement: dom.window.HTMLElement,
});

const NS = 'http://www.w3.org/2000/svg';
const host = document.getElementById('host')!;
const svg = document.createElementNS(NS, 'svg');
host.appendChild(svg);
const measure = document.createElementNS(NS, 'g');
measure.setAttribute('class', 'vf-measure');
svg.appendChild(measure);

function addStavenote(stemX: number, dx: number): void {
  const sn = document.createElementNS(NS, 'g');
  sn.setAttribute('class', 'vf-stavenote');
  if (dx) sn.setAttribute('transform', `translate(${dx}, 0)`);
  const stem = document.createElementNS(NS, 'g');
  stem.setAttribute('class', 'vf-stem');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', `M${stemX} 40L${stemX} 10`);
  stem.appendChild(path);
  const head = document.createElementNS(NS, 'g');
  head.setAttribute('class', 'vf-notehead');
  const hp = document.createElementNS(NS, 'path');
  hp.setAttribute('d', `M${stemX - 5} 40L${stemX + 5} 40`);
  head.appendChild(hp);
  sn.appendChild(stem);
  sn.appendChild(head);
  measure.appendChild(sn);
}

function addBeam(left: number, right: number): SVGPathElement {
  const beam = document.createElementNS(NS, 'g');
  beam.setAttribute('class', 'vf-beam');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', `M${left} 12L${right} 12L${right} 16L${left} 16Z`);
  beam.appendChild(path);
  measure.appendChild(beam);
  return path;
}

function beamRange(path: SVGPathElement): { left: number; right: number } {
  const d = path.getAttribute('d') || '';
  const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  return { left: Math.min(...xs), right: Math.max(...xs) };
}

// Remesh-like: notes moved +10; secondary was OSMD 130-160
addStavenote(100, 10);
addStavenote(130, 10);
addStavenote(160, 10);
addBeam(100, 160);
const secondary = addBeam(130, 160);

syncVfStemsAndBeamsAfterStavenoteAlign(host);
let r = beamRange(secondary);
assert.ok(Math.abs(r.left - 140) < 1.5 && Math.abs(r.right - 170) < 1.5, `pass1 ${r.left}..${r.right}`);

// 2nd sync as if path already reshaped (notes still at +10) — must stay put, not jump to min/max
syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(secondary);
assert.ok(
  Math.abs(r.left - 140) < 1.5 && Math.abs(r.right - 170) < 1.5,
  `pass2 must keep secondary endpoints, got ${r.left}..${r.right}`,
);

console.log('test_double_align_secondary_beam: OK');
