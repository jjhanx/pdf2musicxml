/**
 * OSMD often places beamed stems as measure orphans (id vf-autoN-stem).
 * After onset remesh, 1차 beam matching must include those orphans by Softmax naturalX;
 * otherwise primary floats Softmax while the 16th hook follows remeshed tip → looks glued to the previous group.
 * Run: npx tsx _smoke/test_orphan_stem_primary_hook_remesh.ts
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

function addNoteWithOrphanStem(id: string, stemX: number, dx: number): void {
  const sn = document.createElementNS(NS, 'g');
  sn.setAttribute('class', 'vf-stavenote');
  sn.setAttribute('id', id);
  if (dx) sn.setAttribute('transform', `translate(${dx}, 0)`);
  const head = document.createElementNS(NS, 'g');
  head.setAttribute('class', 'vf-notehead');
  const hp = document.createElementNS(NS, 'path');
  hp.setAttribute('d', `M${stemX - 5} 40L${stemX + 5} 40`);
  head.appendChild(hp);
  sn.appendChild(head);
  measure.appendChild(sn);

  const stem = document.createElementNS(NS, 'g');
  stem.setAttribute('class', 'vf-stem');
  stem.setAttribute('id', `${id}-stem`);
  if (dx) stem.setAttribute('transform', `translate(${dx}, 0)`);
  const sp = document.createElementNS(NS, 'path');
  sp.setAttribute('d', `M${stemX} 40L${stemX} 10`);
  stem.appendChild(sp);
  measure.appendChild(stem);
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

// Softmax: 16th@217 + 16th@236 primary; forward hook on 217
addNoteWithOrphanStem('vf-n16', 217, 0);
addNoteWithOrphanStem('vf-n8', 236, 0);
const primary = addBeam(217, 236, 12);
const hook = addBeam(217, 228.5, 18);

syncVfStemsAndBeamsAfterStavenoteAlign(host);

// Remesh: notes+orphan stems shift like onset column (Softmax 217→199, 236→208)
for (const el of measure.querySelectorAll('.vf-stavenote, :scope > .vf-stem')) {
  const id = el.id || '';
  const dx = id.includes('n16') || id.includes('n16-stem') ? -18 : -28;
  el.setAttribute('transform', `translate(${dx}, 0)`);
}

syncVfStemsAndBeamsAfterStavenoteAlign(host);

const p = beamRange(primary);
const h = beamRange(hook);
assert.ok(
  Math.abs(p.left - 199) < 2.5 && Math.abs(p.right - 208) < 2.5,
  `primary must remesh to orphan tips 199..208, got ${p.left}..${p.right}`,
);
assert.ok(
  Math.abs(h.left - 199) < 2.5,
  `hook must stay on remeshed 16th tip 199, got ${h.left}..${h.right}`,
);
assert.ok(h.right > h.left + 5 && h.right < p.right + 4, `hook free end in primary, got ${h.left}..${h.right}`);

console.log('test_orphan_stem_primary_hook_remesh: OK', { p, h });
