/**
 * Forward 16th→dotted8 Softmax hook must stay on the 16th at every SVG scale (zoom).
 * Softmax often draws the free end near the dotted 8th; short-primary dNat attach
 * flipped to the 8th at mid scales. Softmax primary center → outward attach is stable.
 * Run: npx tsx _smoke/test_forward_hook_zoom_stable_on_16th.ts
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

function beamRange(path: SVGPathElement): { left: number; right: number; w: number } {
  const d = path.getAttribute('d') || '';
  const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  return { left, right, w: right - left };
}

function addStavenote(measure: Element, stemX: number, dx: number): void {
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
}

function addBeam(measure: Element, left: number, right: number, y: number): SVGPathElement {
  const beam = document.createElementNS(NS, 'g');
  beam.setAttribute('class', 'vf-beam');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', `M${left} ${y}L${right} ${y}L${right} ${y + 4}L${left} ${y + 4}Z`);
  beam.appendChild(path);
  measure.appendChild(beam);
  return path;
}

function sceneAtScale(scale: number): void {
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  host.appendChild(svg);
  const measure = document.createElementNS(NS, 'g');
  measure.setAttribute('class', 'vf-measure');
  svg.appendChild(measure);
  const s = (n: number) => n * scale;
  // Softmax: 16th then dotted 8th; forward hook free end pulled toward dotted 8th
  const n16 = s(100);
  const n8 = s(118);
  const dx = s(4);
  addStavenote(measure, n16, dx);
  addStavenote(measure, n8, dx);
  addBeam(measure, n16, n8, s(12));
  const gap = n8 - n16;
  // Softmax shifted hook: starts past 16th, free end almost on dotted 8th
  const hookL = n16 + gap * 0.35;
  const hookR = n8 - gap * 0.05;
  const hook = addBeam(measure, hookL, hookR, s(18));

  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  syncVfStemsAndBeamsAfterStavenoteAlign(host);

  const tip16 = n16 + dx;
  const tip8 = n8 + dx;
  const r = beamRange(hook);
  const tol = Math.max(1.5, 2 * scale);
  assert.ok(
    Math.abs(r.left - tip16) < tol || Math.abs(r.right - tip16) < tol,
    `scale=${scale}: hook must attach to 16th ${tip16}, got ${r.left}..${r.right}`,
  );
  assert.ok(
    Math.abs(r.left - tip8) > tol && Math.abs(r.right - tip8) > tol,
    `scale=${scale}: must not attach to dotted 8th ${tip8}, got ${r.left}..${r.right}`,
  );
}

for (const scale of [0.45, 0.55, 0.7, 0.85, 1.0, 1.2, 1.5]) {
  sceneAtScale(scale);
}
console.log('test_forward_hook_zoom_stable_on_16th: OK');
