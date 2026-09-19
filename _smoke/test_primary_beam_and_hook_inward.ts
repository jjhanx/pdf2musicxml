/**
 * Primary beams must keep all member stems after remesh (not shrink to 2 endpoints).
 * Short hooks must point toward primary center (not outward).
 * Run: npx tsx _smoke/test_primary_beam_and_hook_inward.ts
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

function addBeam(left: number, right: number, y = 12): SVGPathElement {
  const beam = document.createElementNS(NS, 'g');
  beam.setAttribute('class', 'vf-beam');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', `M${left} ${y}L${right} ${y}L${right} ${y + 4}L${left} ${y + 4}Z`);
  beam.appendChild(path);
  measure.appendChild(beam);
  return path;
}

function beamRange(path: SVGPathElement): { left: number; right: number } {
  const d = path.getAttribute('d') || '';
  const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  return { left: Math.min(...xs), right: Math.max(...xs) };
}

// --- Primary spans 4 stems; remesh spreads them — must keep first..last ---
measure.innerHTML = '';
addStavenote(100, 0);
addStavenote(120, 10);
addStavenote(140, 20);
addStavenote(160, 30);
const primary = addBeam(100, 160);
syncVfStemsAndBeamsAfterStavenoteAlign(host);
let r = beamRange(primary);
assert.ok(Math.abs(r.left - 100) < 1.5, `primary left ${r.left}`);
assert.ok(Math.abs(r.right - 190) < 1.5, `primary right ${r.right} (all 4 stems)`);

// --- Secondary stays on its endpoints ---
measure.innerHTML = '';
addStavenote(100, 0);
addStavenote(130, 0);
addStavenote(160, 0);
addBeam(100, 160);
const secondary = addBeam(130, 160, 18);
syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(secondary);
assert.ok(Math.abs(r.left - 130) < 1.5 && Math.abs(r.right - 160) < 1.5, `secondary ${r.left}..${r.right}`);

// --- Outward hook on first stem flips inward toward primary center ---
measure.innerHTML = '';
addStavenote(100, 0);
addStavenote(130, 0);
addStavenote(160, 0);
addBeam(100, 160);
// hook attached at 100 but free end to the LEFT (outward)
const hook = addBeam(90, 100, 18);
syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(hook);
assert.ok(r.left >= 99.5 && r.right > 105, `hook should flip inward right of stem, got ${r.left}..${r.right}`);

console.log('test_primary_beam_and_hook_inward: OK');
