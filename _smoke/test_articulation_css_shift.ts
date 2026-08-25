/**
 * Accent 거리 — 호스트 CSS 변수 + index.css transform:translateY (SVG는 translate 속성 무시).
 * Run: npx tsx _smoke/test_articulation_css_shift.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  applyHitlArticulationHostCss,
  extraYPxFromArticulationFixes,
} from '../src/osmdArticulationOffsetFix';

const css = fs.readFileSync(path.join('src', 'index.css'), 'utf8');
assert.match(
  css,
  /\.omr-osmd-clickable\[data-hitl-art-dy\]:not\(\[data-hitl-art-dy='0'\]\) \.vf-modifiers:not\(\[transform\]\)/,
);
assert.match(css, /transform:\s*translateY\(var\(--hitl-art-dy/);
assert.doesNotMatch(css, /translate:\s*0 var\(--hitl-art-dy/);

const five = extraYPxFromArticulationFixes(
  [{ kind: 'setArticulationPlacement', partId: 'P5', measureMxl: 19, articulation: 'accent', distance: '5', placement: 'below' }],
  10,
);
assert.equal(five, 40, `5칸 extraY=${five}`);
const auto = extraYPxFromArticulationFixes(
  [{ kind: 'setArticulationPlacement', partId: 'P5', measureMxl: 19, articulation: 'accent', distance: 'auto', placement: 'below' }],
  10,
);
assert.equal(auto, 0);

const dom = new JSDOM(`<!DOCTYPE html><html><body>
<div class="omr-osmd-clickable" id="host">
  <svg><g class="vf-modifiers"><path d="M0 0"/></g></svg>
</div>
</body></html>`);
const host = dom.window.document.getElementById('host') as HTMLElement;
applyHitlArticulationHostCss(host, five);
assert.equal(host.getAttribute('data-hitl-art-dy'), '40');
assert.equal(host.style.getPropertyValue('--hitl-art-dy').trim(), '40px');

console.log('articulation css transform translateY ok', { five, auto });
