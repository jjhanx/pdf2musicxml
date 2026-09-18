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

// Parallel voice at same x-column but different Y (m4 PL D2 under D3 beam): must NOT pull beam
measure.innerHTML = '';
addStavenote(164, 0); // beam member (stem-up tip near y=10)
addStavenote(182, 0);
addStavenote(200, 0);
// other-voice stem-down far below beam (y=40..70), ~10px left of beam start
{
  const sn = document.createElementNS(NS, 'g');
  sn.setAttribute('class', 'vf-stavenote');
  const stem = document.createElementNS(NS, 'g');
  stem.setAttribute('class', 'vf-stem');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M153 40L153 70');
  stem.appendChild(path);
  const head = document.createElementNS(NS, 'g');
  head.setAttribute('class', 'vf-notehead');
  const hp = document.createElementNS(NS, 'path');
  hp.setAttribute('d', 'M148 40L158 40');
  head.appendChild(hp);
  sn.appendChild(stem);
  sn.appendChild(head);
  measure.appendChild(sn);
}
const beam4 = addBeam(163, 200); // already on first real member stem at 164
syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(beam4);
assert.ok(
  Math.abs(r.left - 163) < 2 || Math.abs(r.left - 164) < 2,
  `parallel-voice stem must not pull beam left to 153, got ${r.left}`,
);
assert.ok(r.left > 155, `beam must stay near D3 stem, not D2, got ${r.left}`);

// Short forward hook (16th→dotted 8th): must NOT stretch to the next stem (~20px away)
measure.innerHTML = '';
addStavenote(100, 0); // 16th
addStavenote(122, 0); // dotted 8th
const hook = addBeam(100, 111.5); // ~11.5px partial secondary
syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(hook);
assert.ok(r.right - r.left < 16, `hook must stay short, got w=${r.right - r.left} (${r.left}..${r.right})`);
assert.ok(r.right < 118, `hook must not reach dotted-8th stem at 122, got right=${r.right}`);

console.log('test_beam_snap_to_stems: OK');
