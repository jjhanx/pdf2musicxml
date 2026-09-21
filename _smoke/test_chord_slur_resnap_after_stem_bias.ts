/**
 * After slur-distance span stretch (stem X), chord slur re-snap must pull ends
 * back to opposite/displaced noteheads — not stay skewed right on the stem.
 * Run: npx tsx _smoke/test_chord_slur_resnap_after_stem_bias.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { snapOsmdChordSlurSvgToNoteheads } from '../src/osmdChordSlurFix';

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

function addChord(stemX: number, headOffsets: number[], y0: number): void {
  const sn = document.createElementNS(NS, 'g');
  sn.setAttribute('class', 'vf-stavenote');
  for (let i = 0; i < headOffsets.length; i++) {
    const hx = stemX + headOffsets[i]!;
    const hy = y0 - i * 12;
    const head = document.createElementNS(NS, 'g');
    head.setAttribute('class', 'vf-notehead');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M${hx - 4} ${hy}L${hx + 4} ${hy}L${hx + 4} ${hy + 6}L${hx - 4} ${hy + 6}Z`);
    head.appendChild(p);
    sn.appendChild(head);
  }
  svg.appendChild(sn);
}

function addCurve(minX: number, maxX: number, y: number, markSnap: boolean): SVGPathElement {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'vf-curve');
  const path = document.createElementNS(NS, 'path');
  // cubic-ish with absolute coords
  path.setAttribute(
    'd',
    `M${minX} ${y}C${minX + 10} ${y - 8} ${maxX - 10} ${y - 8} ${maxX} ${y}`,
  );
  if (markSnap) path.setAttribute('data-hitl-chord-slur-snap', '1');
  g.appendChild(path);
  svg.appendChild(g);
  return path;
}

function pathEnds(p: SVGPathElement): { minX: number; maxX: number } {
  const d = p.getAttribute('d') || '';
  const xs = [...d.matchAll(/-?\d+\.?\d*/g)].map(Number).filter((_, i) => i % 2 === 0);
  // crude: take all numbers as x,y pairs from C/M — use matchAll on M/C coords
  const nums = [...d.matchAll(/-?\d+\.?\d*(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
  const xOnly: number[] = [];
  for (let i = 0; i < nums.length; i += 2) xOnly.push(nums[i]!);
  return { minX: Math.min(...xOnly), maxX: Math.max(...xOnly) };
}

// Opposite heads: left chord heads at stem-8 and stem+6; right similar
addChord(100, [-8, 6], 40);
addChord(200, [-8, 6], 40);
// Distance-offset style: both curves already stretched to stem centers (right-biased)
const c0 = addCurve(100, 200, 20, true);
const c1 = addCurve(100, 200, 22, true);

const n = snapOsmdChordSlurSvgToNoteheads(host, null);
assert.ok(n >= 1, `should re-snap despite prior marker, got ${n}`);

const e0 = pathEnds(c0);
const e1 = pathEnds(c1);
const ends = [e0.minX, e0.maxX, e1.minX, e1.maxX];
const leftSpread = Math.abs(e0.minX - e1.minX);
const rightSpread = Math.abs(e0.maxX - e1.maxX);
assert.ok(leftSpread > 5 || rightSpread > 5, `ends should follow opposite heads, spreads L=${leftSpread} R=${rightSpread} ends=${ends}`);
// Not both stuck on stem X=100/200 only
assert.ok(
  Math.min(e0.minX, e1.minX) < 96 || Math.max(e0.minX, e1.minX) > 104,
  `left ends should leave pure stem 100, got ${e0.minX},${e1.minX}`,
);

console.log('test_chord_slur_resnap_after_stem_bias: OK', { leftSpread, rightSpread, n });
