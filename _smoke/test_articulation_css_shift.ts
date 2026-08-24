/**
 * Accent 거리 — CSS translate가 아니라 SVG transform 속성.
 * Run: npx tsx _smoke/test_articulation_css_shift.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  applyHitlArticulationHostCss,
  applySvgDyToVfModifiers,
  composeSvgTranslateY,
  extraYPxFromArticulationFixes,
} from '../src/osmdArticulationOffsetFix';

const dom = new JSDOM(`<!DOCTYPE html><html><body>
<div class="omr-osmd-clickable" id="host">
  <svg><g class="vf-modifiers"><path transform="translate(1,2)" d="M0 0 L1 1"/></g></svg>
</div>
</body></html>`);

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
});

const host = dom.window.document.getElementById('host') as HTMLElement;
const g = host.querySelector('.vf-modifiers')!;
const path = host.querySelector('path')!;
assert.ok(path.hasAttribute('transform'), 'Accent path has transform (glyph coords, not group)');
assert.equal(g.getAttribute('transform'), null, 'VexFlow Accent group often has no transform');

const five = extraYPxFromArticulationFixes(
  [{ kind: 'setArticulationPlacement', partId: 'P5', measureMxl: 19, articulation: 'accent', distance: '5', placement: 'below' }],
  10,
);
assert.equal(five, 40, `5칸 extraY=${five}`);

applyHitlArticulationHostCss(host, five);
assert.equal(host.getAttribute('data-hitl-art-dy'), '40');

assert.equal(composeSvgTranslateY('', 40), 'translate(0, 40)');
assert.equal(g.getAttribute('transform'), 'translate(0, 40)');
assert.equal((g as SVGElement).style.getPropertyValue('transform'), 'translate(0px, 40px)');

assert.equal(applySvgDyToVfModifiers(host, five), 1, 'idempotent — no double shift');
assert.equal(g.getAttribute('transform'), 'translate(0, 40)');

const fresh = host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
fresh.setAttribute('class', 'vf-modifiers');
fresh.appendChild(path);
g.replaceWith(fresh);
applySvgDyToVfModifiers(host, five);
assert.equal(fresh.getAttribute('transform'), 'translate(0, 40)', 'OSMD new node reapplied');
assert.equal((fresh as SVGElement).style.getPropertyValue('transform'), 'translate(0px, 40px)');

const auto = extraYPxFromArticulationFixes(
  [{ kind: 'setArticulationPlacement', partId: 'P5', measureMxl: 19, articulation: 'accent', distance: 'auto', placement: 'below' }],
  10,
);
assert.equal(auto, 0);
assert.equal(applySvgDyToVfModifiers(host, auto), 1);
assert.equal(fresh.getAttribute('transform') || '', '');
assert.equal((fresh as SVGElement).style.getPropertyValue('transform'), '');

console.log('articulation svg dy shift ok', { five, auto });
