/**
 * After remesh, Softmax hook coords lag behind tip effectiveX; 2nd sync must re-snap
 * even when tip falls outside the reshaped (short) primary Softmax span.
 * Also: contain(-103) then remesh back toward Softmax must keep forward attach side
 * (proximity would flip free end onto the dotted-8th stem).
 * Run: npx tsx _smoke/test_hook_follow_remeshed_tip.ts
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

function addStavenote(stemX: number, dx: number): Element {
  const sn = document.createElementNS(NS, 'g');
  sn.setAttribute('class', 'vf-stavenote');
  if (dx) sn.setAttribute('transform', `translate(${dx}, 0)`);
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
  return sn;
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

function beamRange(path: SVGPathElement): { left: number; right: number } {
  const d = path.getAttribute('d') || '';
  const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  return { left: Math.min(...xs), right: Math.max(...xs) };
}

function setNoteDx(sn: Element, dx: number): void {
  sn.setAttribute('transform', `translate(${dx}, 0)`);
}

// Softmax: 16th@217 + dotted8@236, forward hook on 16th
const sn16 = addStavenote(217, -103);
const sn8 = addStavenote(236, -103);
addBeam(217, 236, 12);
const hook = addBeam(217, 228.5, 18);

syncVfStemsAndBeamsAfterStavenoteAlign(host);
let r = beamRange(hook);
assert.ok(
  Math.abs(r.left - 114) < 2,
  `pass1 forward hook must attach LEFT @114, got ${r.left}..${r.right}`,
);

setNoteDx(sn16, -83);
setNoteDx(sn8, -83);
const primaryPath = [...measure.querySelectorAll('.vf-beam path')].find((p) => {
  const xs = [...(p.getAttribute('d') || '').matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) =>
    parseFloat(m[1]!),
  );
  return Math.max(...xs) - Math.min(...xs) > 14;
});
if (primaryPath) {
  primaryPath.setAttribute('d', 'M114 12L133 12L133 16L114 16Z');
}

syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(hook);
const tip16 = 217 - 83;
assert.ok(
  Math.abs(r.left - tip16) < 2.5,
  `pass2 hook must follow tip LEFT to ${tip16}, got ${r.left}..${r.right}`,
);
assert.ok(r.right - r.left < 14, `hook must stay short, w=${r.right - r.left}`);

// Large remesh jump back to Softmax — proximity would flip attach to right end.
setNoteDx(sn16, 0);
setNoteDx(sn8, 0);
syncVfStemsAndBeamsAfterStavenoteAlign(host);
r = beamRange(hook);
assert.ok(
  Math.abs(r.left - 217) < 2.5,
  `pass3 after large remesh jump: attach LEFT @217, got ${r.left}..${r.right}`,
);
assert.ok(
  r.right > r.left + 5 && r.right < 236,
  `pass3 forward hook must extend right of 16th, got ${r.left}..${r.right}`,
);

console.log('test_hook_follow_remeshed_tip: OK', r);
