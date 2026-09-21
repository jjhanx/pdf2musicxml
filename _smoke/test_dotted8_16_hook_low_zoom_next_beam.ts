/**
 * m15 PR style: dotted-8th + 16th, then a following 8th beam.
 * At low zoom (scale ≤0.6) Softmax gaps shrink; fixed hookMaxW=12 used to
 * reclassify the dotted8–16 primary as a hook and snap the 16th hook onto the
 * next 8th beam. Hook must stay on the 16th and clear of the next primary.
 * Run: npx tsx _smoke/test_dotted8_16_hook_low_zoom_next_beam.ts
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

function sceneAtScale(scale: number): void {
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  host.appendChild(svg);
  const measure = document.createElementNS(NS, 'g');
  measure.setAttribute('class', 'vf-measure');
  svg.appendChild(measure);
  const s = (n: number) => n * scale;
  // Softmax-ish tight spacing (real zoom~0.5–0.6): gap ~18 → ~9–11px
  const nat = [100, 118, 140, 158].map(s);
  const dx = 6 * scale;
  const eff = nat.map((x) => x + dx);
  for (const x of nat) addStavenote(measure, x, dx, scale);

  // dotted8–16th primary (width ≈ one gap — must stay primary, not hook)
  const primary = addBeam(measure, nat[0]!, nat[1]!, s(12), Math.max(2, s(4)));
  // backward hook on 16th toward dotted8 (~0.4 gap)
  const gap = nat[1]! - nat[0]!;
  const hookW = Math.min(gap * 0.42, 11 * scale);
  const hook = addBeam(measure, nat[1]! - hookW, nat[1]!, s(18), Math.max(2, s(4)));
  // next 8th–8th beam
  const nextPrimary = addBeam(measure, nat[2]!, nat[3]!, s(12), Math.max(2, s(4)));

  syncVfStemsAndBeamsAfterStavenoteAlign(host);
  syncVfStemsAndBeamsAfterStavenoteAlign(host);

  const tol = 1.5 * Math.max(1, scale);
  const pr = beamRange(primary);
  assert.ok(
    Math.abs(pr.left - eff[0]!) < tol && Math.abs(pr.right - eff[1]!) < tol,
    `scale=${scale}: dotted8–16 primary ${pr.left}..${pr.right} want ${eff[0]}..${eff[1]}`,
  );
  assert.ok(pr.w > gap * 0.75, `scale=${scale}: primary collapsed to hook w=${pr.w} gap=${gap}`);

  const hk = beamRange(hook);
  assert.ok(
    Math.abs(hk.left - eff[1]!) < tol || Math.abs(hk.right - eff[1]!) < tol,
    `scale=${scale}: hook must stay on 16th ${eff[1]}, got ${hk.left}..${hk.right}`,
  );
  assert.ok(
    Math.max(hk.left, hk.right) < eff[2]! - gap * 0.2,
    `scale=${scale}: hook must not reach next 8th ${eff[2]}, got ${hk.left}..${hk.right}`,
  );

  const np = beamRange(nextPrimary);
  assert.ok(
    Math.abs(np.left - eff[2]!) < tol && Math.abs(np.right - eff[3]!) < tol,
    `scale=${scale}: next 8th beam ${np.left}..${np.right} want ${eff[2]}..${eff[3]}`,
  );
  // clear gap between hook free end and next primary
  const hookRight = Math.max(hk.left, hk.right);
  assert.ok(
    np.left - hookRight > Math.max(1.5, gap * 0.15),
    `scale=${scale}: hook looks glued to next beam (gap ${np.left - hookRight})`,
  );
}

for (const scale of [0.45, 0.55, 0.7, 1.0, 1.4]) {
  sceneAtScale(scale);
}

console.log('test_dotted8_16_hook_low_zoom_next_beam: OK');
