/**
 * m4 PL style: Softmax forward hook shifted toward dotted-8th must stay on the 16th stem.
 * m9 style: 8–16–16 secondary must stay on the last two stems (not look like 16–16–8).
 * Run: npx tsx _smoke/test_m4_forward_hook_and_m9_secondary.ts
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

function addStavenote(measure: Element, stemX: number, dx = 0): void {
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

// --- m4 PL: Softmax hook free end near dotted 8th — must attach to 16th (100), not 118 ---
{
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  host.appendChild(svg);
  const measure = document.createElementNS(NS, 'g');
  measure.setAttribute('class', 'vf-measure');
  svg.appendChild(measure);
  addStavenote(measure, 100, 10); // 16th → 110
  addStavenote(measure, 118, 10); // dotted 8th → 128
  addBeam(measure, 100, 160, 12);
  // Softmax forward hook shifted toward 8th (free end almost on 118)
  const hook = addBeam(measure, 106, 117.5, 18);
  const w0 = beamRange(hook).w;
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  const r = beamRange(hook);
  assert.ok(Math.abs(r.w - w0) < 0.75, `hook must not stretch to 8th, ${w0}→${r.w}`);
  assert.ok(
    Math.abs(r.left - 110) < 2 || Math.abs(r.right - 110) < 2,
    `hook must stay on 16th stem 110, got ${r.left}..${r.right}`,
  );
  assert.ok(Math.max(r.left, r.right) < 124, `must not attach to dotted 8th 128, got ${r.left}..${r.right}`);
}

// --- m9 S/A: 8–16–16 secondary on last two — not first two (would look like 16–16–8) ---
{
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  host.appendChild(svg);
  const measure = document.createElementNS(NS, 'g');
  measure.setAttribute('class', 'vf-measure');
  svg.appendChild(measure);
  addStavenote(measure, 100, 0); // 8th
  addStavenote(measure, 130, 0); // 16th
  addStavenote(measure, 160, 0); // 16th
  addBeam(measure, 100, 160, 12);
  const secondary = addBeam(measure, 130, 160, 18);
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  const r = beamRange(secondary);
  assert.ok(
    Math.abs(r.left - 130) < 1.5 && Math.abs(r.right - 160) < 1.5,
    `secondary must stay on last two 16ths, got ${r.left}..${r.right}`,
  );
  assert.ok(r.left > 115, `must not pull to 8th stem (looks like 16-16-8), left=${r.left}`);
}

console.log('test_m4_forward_hook_and_m9_secondary: OK');
