/**
 * 2nd syncVf after remesh must not shrink primary (8-16-16 → 16-16)
 * or grow an 8-8 beam into the next group's Softmax-overlapping stem.
 * Run: npx tsx _smoke/test_double_align_primary_no_shrink.ts
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

function beamRange(path: SVGPathElement): { left: number; right: number; w: number } {
  const d = path.getAttribute('d') || '';
  const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  return { left, right, w: right - left };
}

// --- m13 T/B: path already remeshed to 8-16-16; Softmax natural of 8th is left of path ---
measure.innerHTML = '';
addStavenote(243, 26); // eighth Softmax 243 → 269
addStavenote(291, 6); // 16th
addStavenote(309, 2); // 16th
const primary81616 = addBeam(269, 311); // already reshaped after pass1
syncVfStemsAndBeamsAfterStavenoteAlign(host);
let r = beamRange(primary81616);
assert.ok(r.w > 35, `pass2 primary must keep 8-16-16 width, got ${r.w} @ ${r.left}..${r.right}`);
assert.ok(Math.abs(r.left - 269) < 2, `pass2 left ${r.left}`);
assert.ok(Math.abs(r.right - 311) < 2, `pass2 right ${r.right}`);

// --- m13 PR: Softmax stem of next group still inside old Softmax span of 8-8 ---
measure.innerHTML = '';
addStavenote(217, 10); // → 227 (group 8-8 left)
addStavenote(235, 22); // → 257 (group 8-8 right)
addStavenote(253, 31); // → 284 (next dotted-8 — must NOT join)
const beam88 = addBeam(227, 257);
syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(beam88);
assert.ok(r.w < 40, `8-8 must not grow into next group, got ${r.w} @ ${r.left}..${r.right}`);
assert.ok(Math.abs(r.right - 257) < 2, `8-8 right must stay ~257, got ${r.right}`);

// --- Softmax primary must not absorb left unbeamed note that remeshed into path span ---
measure.innerHTML = '';
addStavenote(225, 15); // unbeamed → 240 (lands near Softmax beam start)
addStavenote(243, 26); // beamed 8th → 269
addStavenote(291, 6);
addStavenote(309, 2);
const primarySoft = addBeam(243, 309); // Softmax path (1st sync)
syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(primarySoft);
assert.ok(r.left > 250, `1st sync must not pull unbeamed left, left=${r.left}`);
assert.ok(Math.abs(r.left - 269) < 2.5, `beamed 8th left ${r.left}`);
assert.ok(Math.abs(r.right - 311) < 2.5, `right ${r.right}`);

console.log('test_double_align_primary_no_shrink: OK');
