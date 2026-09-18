/**
 * containOsmdMeasureNotesInAllocatedWidth nudges notes left of measure left back in.
 * Run: npx tsx _smoke/test_contain_measure_notes.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { stavenoteContentMinX } from '../src/osmdMeasureTimingWarning';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  Element: dom.window.Element,
  SVGElement: dom.window.SVGElement,
});

const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
g.setAttribute('class', 'vf-stavenote');
g.setAttribute('transform', 'translate(-40, 0)');
const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
path.setAttribute('d', 'M100 50L100 80');
g.appendChild(path);

assert.equal(stavenoteContentMinX(g), 60, 'minX + translate');

console.log('test_contain_measure_notes: OK');
