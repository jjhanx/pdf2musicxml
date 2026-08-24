/**
 * CSS Accent 거리 — :not([transform]) 허점 + host CSS 변수.
 * Run: npx tsx _smoke/test_articulation_css_shift.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyHitlArticulationHostCss, extraYPxFromArticulationFixes } from '../src/osmdArticulationOffsetFix';

const dom = new JSDOM(`<!DOCTYPE html><html><head>
<style>
.omr-osmd-clickable[data-hitl-art-dy] .vf-modifiers {
  translate: 0 var(--hitl-art-dy, 0px);
}
</style>
</head><body>
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
const path = host.querySelector('path')!;
assert.ok(path.hasAttribute('transform'), 'Accent path has transform (regression case)');

const brokenSel =
  '.omr-osmd-clickable[data-hitl-art-dy] .vf-modifiers > path:not([transform])';
assert.equal(host.querySelectorAll(brokenSel).length, 0, 'old CSS matched nothing');

const okSel = '.omr-osmd-clickable[data-hitl-art-dy] .vf-modifiers';
assert.equal(host.querySelectorAll(okSel).length, 0, 'before attr, no match');

const five = extraYPxFromArticulationFixes(
  [{ kind: 'setArticulationPlacement', partId: 'P5', measureMxl: 19, articulation: 'accent', distance: '5', placement: 'below' }],
  10,
);
assert.equal(five, 40, `5칸 extraY=${five}`);

applyHitlArticulationHostCss(host, five);
assert.equal(host.getAttribute('data-hitl-art-dy'), '40');
assert.equal(host.style.getPropertyValue('--hitl-art-dy').trim(), '40px');
assert.equal(host.querySelectorAll(okSel).length, 1, 'new CSS matches vf-modifiers');

const auto = extraYPxFromArticulationFixes(
  [{ kind: 'setArticulationPlacement', partId: 'P5', measureMxl: 19, articulation: 'accent', distance: 'auto', placement: 'below' }],
  10,
);
assert.equal(auto, 0);

console.log('articulation css shift ok', { five, auto });
