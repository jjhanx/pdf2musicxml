/**
 * Stem tips must meet the beam OUTER edge (not center) — center snap looks detached.
 * Run: npx tsx _smoke/test_beam_tip_outer_edge.ts
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

// Stem-up notes: tips currently at beam CENTER (y=12.5) — must extend to OUTER (y=10)
function addOrphanStem(x: number, tipY: number, baseY: number): Element {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'vf-stem');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', `M${x} ${baseY}L${x} ${tipY}`);
  g.appendChild(path);
  measure.appendChild(g);
  // matching notehead so sync keeps the stem
  const sn = document.createElementNS(NS, 'g');
  sn.setAttribute('class', 'vf-stavenote');
  const head = document.createElementNS(NS, 'g');
  head.setAttribute('class', 'vf-notehead');
  const hp = document.createElementNS(NS, 'path');
  hp.setAttribute('d', `M${x - 6} ${baseY}L${x + 6} ${baseY}`);
  head.appendChild(hp);
  sn.appendChild(head);
  measure.appendChild(sn);
  return path;
}

const s1 = addOrphanStem(100, 12.5, 40);
const s2 = addOrphanStem(130, 12.5, 40);
const s3 = addOrphanStem(160, 12.5, 40);

// Primary beam: outer edge y=10, inner y=15 (stem-up)
const beam = document.createElementNS(NS, 'g');
beam.setAttribute('class', 'vf-beam');
const bp = document.createElementNS(NS, 'path');
bp.setAttribute('d', 'M100 10L100 15L160 10L160 15Z');
beam.appendChild(bp);
measure.appendChild(beam);

syncVfStemsAndBeamsAfterStavenoteAlign(host);

for (const [label, path] of [
  ['s1', s1],
  ['s2', s2],
  ['s3', s3],
] as const) {
  const d = path.getAttribute('d') || '';
  const m = /^M\s*([-\d.]+)\s+([-\d.]+)\s*L\s*([-\d.]+)\s+([-\d.]+)/i.exec(d.replace(/\s+/g, ' ').trim());
  assert.ok(m, label);
  const tip = Math.min(+m![2]!, +m![4]!);
  assert.ok(
    tip <= 10.5,
    `${label}: tip should reach outer edge y=10, got ${tip} (center snap would leave ~12.5)`,
  );
}

// Already at outer edge — must not pull tip toward center
const sOk = addOrphanStem(200, 10, 40);
const beam2 = document.createElementNS(NS, 'g');
beam2.setAttribute('class', 'vf-beam');
const bp2 = document.createElementNS(NS, 'path');
bp2.setAttribute('d', 'M200 10L200 15L230 10L230 15Z');
beam2.appendChild(bp2);
measure.appendChild(beam2);
syncVfStemsAndBeamsAfterStavenoteAlign(host);
{
  const d = sOk.getAttribute('d') || '';
  const m = /^M\s*([-\d.]+)\s+([-\d.]+)\s*L\s*([-\d.]+)\s+([-\d.]+)/i.exec(d.replace(/\s+/g, ' ').trim());
  const tip = Math.min(+m![2]!, +m![4]!);
  assert.ok(tip <= 10.5, `must not shorten tip away from outer edge, got ${tip}`);
}

console.log('test_beam_tip_outer_edge: OK');
