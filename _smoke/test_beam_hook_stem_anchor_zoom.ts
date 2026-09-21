/**
 * 16th hooks: (1) attach end snaps to stem tip without stretching to next stem;
 * (2) secondary vs hook classification stays correct when SVG coords scale (zoom).
 * Does NOT change pad/orphan matching — only hookMaxW + stem-tip anchor.
 * Run: npx tsx _smoke/test_beam_hook_stem_anchor_zoom.ts
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

function addStavenote(measure: Element, stemX: number, dx: number, scale: number): void {
  const sn = document.createElementNS(NS, 'g');
  sn.setAttribute('class', 'vf-stavenote');
  if (dx) sn.setAttribute('transform', `translate(${dx}, 0)`);
  const stem = document.createElementNS(NS, 'g');
  stem.setAttribute('class', 'vf-stem');
  const sp = document.createElementNS(NS, 'path');
  sp.setAttribute('d', `M${stemX} ${40 * scale}L${stemX} ${10 * scale}`);
  stem.appendChild(sp);
  const head = document.createElementNS(NS, 'g');
  head.setAttribute('class', 'vf-notehead');
  const hp = document.createElementNS(NS, 'path');
  hp.setAttribute('d', `M${stemX - 5 * scale} ${40 * scale}L${stemX + 5 * scale} ${40 * scale}`);
  head.appendChild(hp);
  sn.appendChild(stem);
  sn.appendChild(head);
  measure.appendChild(sn);
}

function addBeam(measure: Element, left: number, right: number, y: number, h: number): SVGPathElement {
  const beam = document.createElementNS(NS, 'g');
  beam.setAttribute('class', 'vf-beam');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', `M${left} ${y}L${right} ${y}L${right} ${y + h}L${left} ${y + h}Z`);
  beam.appendChild(path);
  measure.appendChild(beam);
  return path;
}

// --- A: Softmax hook slightly off stem; remesh dx — snap attach to stem, keep width ---
{
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  host.appendChild(svg);
  const measure = document.createElementNS(NS, 'g');
  measure.setAttribute('class', 'vf-measure');
  svg.appendChild(measure);
  addStavenote(measure, 100, 10, 1);
  addStavenote(measure, 118, 10, 1);
  addBeam(measure, 100, 160, 12, 4);
  // Softmax forward hook on stem 100, 2px short of tip (98–109.5 would straddle wrong)
  const hook = addBeam(measure, 100, 111.5, 18, 4);
  const w0 = beamRange(hook).w;
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  const r = beamRange(hook);
  assert.ok(Math.abs(r.w - w0) < 0.5, `hook width must not stretch, ${w0}→${r.w}`);
  assert.ok(
    Math.abs(r.left - 110) < 1.5 || Math.abs(r.right - 110) < 1.5,
    `hook must attach to stem tip 110, got ${r.left}..${r.right}`,
  );
  assert.ok(r.w < 14, `must not become secondary to stem 128, w=${r.w}`);
}

// --- A2: Softmax tip slightly left of stem — rigid snap, no stretch ---
{
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  host.appendChild(svg);
  const measure = document.createElementNS(NS, 'g');
  measure.setAttribute('class', 'vf-measure');
  svg.appendChild(measure);
  addStavenote(measure, 100, 10, 1);
  addStavenote(measure, 118, 10, 1);
  addBeam(measure, 100, 160, 12, 4);
  const hook = addBeam(measure, 97, 108.5, 18, 4);
  const w0 = beamRange(hook).w;
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  const r = beamRange(hook);
  assert.ok(Math.abs(r.w - w0) < 0.5, `A2 width ${w0}→${r.w}`);
  assert.ok(
    Math.abs(r.left - 110) < 1.5 || Math.abs(r.right - 110) < 1.5,
    `A2 attach stem 110, got ${r.left}..${r.right}`,
  );
  assert.ok(Math.max(r.left, r.right) < 124, `A2 must not reach stem 128`);
}

// --- B: multi-zoom 16–8–16: secondary spans last two; hook stays short on first ---
function sceneAtScale(scale: number, remeshDx: number): void {
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  host.appendChild(svg);
  const measure = document.createElementNS(NS, 'g');
  measure.setAttribute('class', 'vf-measure');
  svg.appendChild(measure);
  const s = (n: number) => n * scale;
  const nat = [100, 130, 160].map(s);
  const dx = remeshDx * scale;
  const eff = nat.map((x) => x + dx);
  for (const x of nat) addStavenote(measure, x, dx, scale);
  addBeam(measure, nat[0]!, nat[2]!, s(12), Math.max(2, s(4)));
  const secondary = addBeam(measure, nat[1]!, nat[2]!, s(18), Math.max(2, s(4)));
  const gap = nat[1]! - nat[0]!;
  const hook = addBeam(measure, nat[0]! - gap * 0.33, nat[0]!, s(18), Math.max(2, s(4)));
  const hookW0 = beamRange(hook).w;

  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  syncVfStemsAndBeamsAfterStavenoteAlign(host);

  const sec = beamRange(secondary);
  const tol = 1.5 * Math.max(1, scale);
  assert.ok(
    Math.abs(sec.left - eff[1]!) < tol && Math.abs(sec.right - eff[2]!) < tol,
    `scale=${scale}: secondary ${sec.left}..${sec.right} want ${eff[1]}..${eff[2]}`,
  );
  const hk = beamRange(hook);
  assert.ok(Math.abs(hk.w - hookW0) < 0.75 * Math.max(1, scale), `scale=${scale}: hook stretched ${hookW0}→${hk.w}`);
  assert.ok(
    Math.abs(hk.left - eff[0]!) < tol || Math.abs(hk.right - eff[0]!) < tol,
    `scale=${scale}: hook not on stem ${eff[0]}, got ${hk.left}..${hk.right}`,
  );
  assert.ok(hk.w < gap * 0.7, `scale=${scale}: hook grew toward secondary, w=${hk.w}`);
}

for (const scale of [0.35, 0.5, 0.6, 1.0, 1.5, 2.0]) {
  sceneAtScale(scale, 10);
}

console.log('test_beam_hook_stem_anchor_zoom: OK');
