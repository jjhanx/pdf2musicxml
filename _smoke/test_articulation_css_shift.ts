/**
 * Accent 거리 — 전역 CSS .vf-modifiers 규칙 제거 + extraY 수식.
 * Run: npx tsx _smoke/test_articulation_css_shift.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extraYPxFromArticulationFixes } from '../src/osmdArticulationOffsetFix';

const css = fs.readFileSync(path.join('src', 'index.css'), 'utf8');
assert.doesNotMatch(
  css,
  /\.omr-osmd-clickable\[data-hitl-art-dy\][^{]*\.vf-modifiers/,
  'must not globally CSS-shift all .vf-modifiers',
);

const five = extraYPxFromArticulationFixes(
  [
    {
      kind: 'setArticulationPlacement',
      partId: 'P5',
      measureMxl: 19,
      articulation: 'accent',
      distance: '5',
      placement: 'below',
    },
  ],
  10,
);
assert.equal(five, 40, `5칸 preview Δ=${five} (OSMD 1칸 대비; MXL default-y=±50)`);
const auto = extraYPxFromArticulationFixes(
  [
    {
      kind: 'setArticulationPlacement',
      partId: 'P5',
      measureMxl: 19,
      articulation: 'accent',
      distance: 'auto',
      placement: 'below',
    },
  ],
  10,
);
assert.equal(auto, 0);

console.log('articulation css/global-shift guard ok', { five, auto });
