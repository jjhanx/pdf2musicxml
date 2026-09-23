/**
 * 16–8–16: align이 그룹을 Softmax 중심보다 더 오른쪽으로 밀어도
 * 첫 16분 forward hook는 빔 안(오른쪽), 마지막 backward hook는 빔 안(왼쪽).
 * Run: npx tsx _smoke/test_16_8_16_first_hook_inward_after_shift.ts
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

function beamRange(path: SVGPathElement): { left: number; right: number } {
  const d = path.getAttribute('d') || '';
  const xs = [...d.matchAll(/[MmLl]\s*([-\d.]+)/g)].map((m) => parseFloat(m[1]!));
  return { left: Math.min(...xs), right: Math.max(...xs) };
}

function addStavenote(measure: Element, stemX: number, dx: number): void {
  const sn = document.createElementNS(NS, 'g');
  sn.setAttribute('class', 'vf-stavenote');
  sn.setAttribute('transform', `translate(${dx}, 0)`);
  const stem = document.createElementNS(NS, 'g');
  stem.setAttribute('class', 'vf-stem');
  const sp = document.createElementNS(NS, 'path');
  sp.setAttribute('d', `M${stemX} 40L${stemX} 8`);
  stem.appendChild(sp);
  sn.appendChild(stem);
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

// Softmax: 앞 8분쌍(40–70) + 16–8–16(100,140,180). center=140.
// dx=50이면 화면상 첫 16분(150)이 Softmax 중심(140)보다 오른쪽 — 예전 flip이 꼬리를 바깥으로 뒤집음.
const dx = 50;
host.innerHTML = '';
const svg = document.createElementNS(NS, 'svg');
host.appendChild(svg);
const measure = document.createElementNS(NS, 'g');
measure.setAttribute('class', 'vf-measure');
svg.appendChild(measure);
for (const x of [40, 70, 100, 140, 180]) addStavenote(measure, x, dx);
addBeam(measure, 40, 70, 12);
addBeam(measure, 100, 180, 12);
const fwd = addBeam(measure, 100, 111, 18);
const back = addBeam(measure, 169, 180, 18);

syncVfStemsAndBeamsAfterStavenoteAlign(host);
syncVfStemsAndBeamsAfterStavenoteAlign(host);

const firstStem = 100 + dx;
const lastStem = 180 + dx;
const fwdR = beamRange(fwd);
const backR = beamRange(back);
const tol = 2;
assert.ok(
  Math.abs(fwdR.left - firstStem) < tol,
  `forward hook left must sit on first 16th ${firstStem}, got ${fwdR.left}..${fwdR.right}`,
);
assert.ok(
  fwdR.right > firstStem + 3,
  `forward hook must extend inward (right), got ${fwdR.left}..${fwdR.right}`,
);
assert.ok(
  Math.abs(backR.right - lastStem) < tol,
  `backward hook right must sit on last 16th ${lastStem}, got ${backR.left}..${backR.right}`,
);
assert.ok(
  backR.left < lastStem - 3,
  `backward hook must extend inward (left), got ${backR.left}..${backR.right}`,
);
console.log('test_16_8_16_first_hook_inward_after_shift: OK', fwdR, backR);
