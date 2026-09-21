/**
 * 16–8–16: Softmax may draw the first 16th hook ~2× longer than the last.
 * After sync, hooks under the same primary must be short & uniform (not reach the 8th).
 * Run: npx tsx _smoke/test_hook_length_uniform_16_8_16.ts
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

function addStavenote(stemX: number): void {
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
}

function addBeam(left: number, right: number, y: number): SVGPathElement {
  const beam = document.createElementNS(NS, 'g');
  beam.setAttribute('class', 'vf-beam');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', `M${left} ${y}L${right} ${y}L${right} ${y + 4}L${left} ${y + 4}Z`);
  beam.appendChild(path);
  measure.appendChild(beam);
  return path;
}

function beamW(path: SVGPathElement): number {
  const d = path.getAttribute('d') || '';
  const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  return Math.max(...xs) - Math.min(...xs);
}

function beamRange(path: SVGPathElement): { left: number; right: number } {
  const d = path.getAttribute('d') || '';
  const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  return { left: Math.min(...xs), right: Math.max(...xs) };
}

// stems: 16th @100, 8th @130, 16th @160
addStavenote(100);
addStavenote(130);
addStavenote(160);
addBeam(100, 160, 12); // primary
// Softmax: first hook almost to the 8th (~11.5), last hook short (~6)
const hookL = addBeam(100, 111.5, 18);
const hookR = addBeam(154, 160, 18);

syncVfStemsAndBeamsAfterStavenoteAlign(host);
syncVfStemsAndBeamsAfterStavenoteAlign(host);

const wL = beamW(hookL);
const wR = beamW(hookR);
assert.ok(wL < 9.5 && wR < 9.5, `hooks must stay short (not reach 8th), got ${wL}, ${wR}`);
assert.ok(
  Math.abs(wL - wR) < 2.5,
  `hooks under same primary should be uniform, got ${wL} vs ${wR}`,
);
const rL = beamRange(hookL);
const rR = beamRange(hookR);
assert.ok(rL.right < 122, `left hook must not reach 8th stem 130, right=${rL.right}`);
assert.ok(rR.left > 138, `right hook must not reach 8th stem 130, left=${rR.left}`);
assert.ok(
  Math.abs(rL.left - 100) < 1.5 || Math.abs(rL.right - 100) < 1.5,
  `left hook stays on first 16th, ${rL.left}..${rL.right}`,
);
assert.ok(
  Math.abs(rR.left - 160) < 1.5 || Math.abs(rR.right - 160) < 1.5,
  `right hook stays on last 16th, ${rR.left}..${rR.right}`,
);

console.log('test_hook_length_uniform_16_8_16: OK', { wL, wR });
