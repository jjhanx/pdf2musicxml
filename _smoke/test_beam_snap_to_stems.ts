/**
 * After contain/align, beam left/right must sit on stem tips (not past first stem toward barline).
 * Run: npx tsx _smoke/test_beam_snap_to_stems.ts
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
  // 줄기를 지나 앞으로 삐져나온 빔 (left << first stem)
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

// stems at 100 and 140; beam overhangs left to 70 (measure front)
addStavenote(100, 0);
addStavenote(140, 0);
const beamPath = addBeam(70, 140);

syncVfStemsAndBeamsAfterStavenoteAlign(host);
let r = beamRange(beamPath);
assert.ok(Math.abs(r.left - 100) < 1.5, `beam left snapped to stem, got ${r.left}`);
assert.ok(Math.abs(r.right - 140) < 1.5, `beam right on stem, got ${r.right}`);

// contain-style: notes shifted +20, beam still at old — sync must follow
measure.innerHTML = '';
addStavenote(100, 20);
addStavenote(140, 20);
const beam2 = addBeam(100, 140);
syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(beam2);
assert.ok(Math.abs(r.left - 120) < 1.5, `beam follows translate, left=${r.left}`);
assert.ok(Math.abs(r.right - 160) < 1.5, `beam follows translate, right=${r.right}`);

// OSMD: first stem ~10px left of beam start (8th+16th stem-up) — pull beam to orphan stem
measure.innerHTML = '';
addStavenote(100, 0);
addStavenote(120, 0);
addStavenote(140, 0);
const beam3 = addBeam(110, 140); // starts after first stem
syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(beam3);
assert.ok(Math.abs(r.left - 100) < 1.5, `beam left pulls to orphan first stem, got ${r.left}`);
assert.ok(Math.abs(r.right - 140) < 1.5, `beam right stays on last stem, got ${r.right}`);

console.log('test_beam_snap_to_stems: OK');
