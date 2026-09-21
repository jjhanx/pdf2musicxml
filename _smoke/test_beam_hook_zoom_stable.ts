/**
 * Mixed 8th/16th beams: secondary + hook classification must stay correct when
 * all SVG coords are scaled (as with OSMD zoom). Fixed px hook&lt;12 used to
 * mis-classify short secondaries at low zoom and long hooks at high zoom.
 * Run: npx tsx _smoke/test_beam_hook_zoom_stable.ts
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

/** 16–8–16 under one primary: secondary on last two 16ths, outward hook on first. */
function buildScene(scale: number, remeshDx: number): {
  secondary: SVGPathElement;
  hook: SVGPathElement;
  stemEff: number[];
  stemNat: number[];
  gap: number;
} {
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  host.appendChild(svg);
  const measure = document.createElementNS(NS, 'g');
  measure.setAttribute('class', 'vf-measure');
  svg.appendChild(measure);

  const s = (n: number) => n * scale;
  // Softmax natural stems; remesh moves each by remeshDx*scale
  const stemNat = [100, 130, 160].map(s);
  const dx = remeshDx * scale;
  const stemEff = stemNat.map((x) => x + dx);
  const gap = stemNat[1]! - stemNat[0]!;

  for (const x of stemNat) {
    const sn = document.createElementNS(NS, 'g');
    sn.setAttribute('class', 'vf-stavenote');
    if (dx) sn.setAttribute('transform', `translate(${dx}, 0)`);
    const stem = document.createElementNS(NS, 'g');
    stem.setAttribute('class', 'vf-stem');
    const sp = document.createElementNS(NS, 'path');
    sp.setAttribute('d', `M${x} ${s(40)}L${x} ${s(10)}`);
    stem.appendChild(sp);
    const head = document.createElementNS(NS, 'g');
    head.setAttribute('class', 'vf-notehead');
    const hp = document.createElementNS(NS, 'path');
    hp.setAttribute('d', `M${x - s(5)} ${s(40)}L${x + s(5)} ${s(40)}`);
    head.appendChild(hp);
    sn.appendChild(stem);
    sn.appendChild(head);
    measure.appendChild(sn);
  }

  const addBeam = (left: number, right: number, y: number): SVGPathElement => {
    const beam = document.createElementNS(NS, 'g');
    beam.setAttribute('class', 'vf-beam');
    const path = document.createElementNS(NS, 'path');
    const h = Math.max(2, s(4));
    path.setAttribute('d', `M${left} ${y}L${right} ${y}L${right} ${y + h}L${left} ${y + h}Z`);
    beam.appendChild(path);
    measure.appendChild(beam);
    return path;
  };

  addBeam(stemNat[0]!, stemNat[2]!, s(12)); // primary
  const secondary = addBeam(stemNat[1]!, stemNat[2]!, s(18)); // 16–16 secondary
  // Softmax hook ~1/3 of stem gap (true hook, not a full secondary)
  const hookW = gap * 0.33;
  const hook = addBeam(stemNat[0]! - hookW, stemNat[0]!, s(18)); // outward

  return { secondary, hook, stemEff, stemNat, gap };
}

function assertScene(scale: number, remeshDx: number): void {
  const { secondary, hook, stemEff, stemNat, gap } = buildScene(scale, remeshDx);
  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  // Second pass (UI double-align) must stay stable
  syncVfStemsAndBeamsAfterStavenoteAlign(host);

  const sec = beamRange(secondary);
  const tol = 1.5 * Math.max(1, scale);
  assert.ok(
    Math.abs(sec.left - stemEff[1]!) < tol && Math.abs(sec.right - stemEff[2]!) < tol,
    `scale=${scale}: secondary should span stems ${stemEff[1]}..${stemEff[2]}, got ${sec.left}..${sec.right}`,
  );

  const hk = beamRange(hook);
  // Hook path stays in Softmax/natural coords (+ optional beam translate); flip rewrites path about stem.
  const attach = Math.min(
    Math.abs(hk.left - stemNat[0]!),
    Math.abs(hk.right - stemNat[0]!),
  );
  assert.ok(
    attach < 2 * Math.max(1, scale),
    `scale=${scale}: hook must stay on first stem (natural ${stemNat[0]}), got ${hk.left}..${hk.right}`,
  );
  assert.ok(
    Math.max(hk.left, hk.right) > stemNat[0]! + 1 * Math.max(0.5, scale),
    `scale=${scale}: hook free end must flip inward (right of stem), got ${hk.left}..${hk.right}`,
  );
  // Must not have been reshaped into a full secondary spanning two stems
  assert.ok(
    hk.w < gap * 0.7,
    `scale=${scale}: hook must not grow into secondary width, w=${hk.w} gap=${gap}`,
  );
}

for (const scale of [0.35, 0.5, 0.6, 1.0, 1.5, 2.0]) {
  assertScene(scale, 10);
}

console.log('test_beam_hook_zoom_stable: OK');
