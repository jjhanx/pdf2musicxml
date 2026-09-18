/**
 * allocatedMeasureWidthOsmd — Size.width≤0이어도 다음 마디 absX로 폭 복구.
 * Run: npx tsx _smoke/test_allocated_measure_width_clip.ts
 */
import assert from 'node:assert/strict';
import { allocatedMeasureWidthOsmd } from '../src/osmdMeasureTimingWarning';

function gm(absX: number, sizeW: number): unknown {
  return {
    PositionAndShape: {
      AbsolutePosition: { x: absX },
      Size: { width: sizeW, height: 40 },
    },
  };
}

// Size.width 정상
assert.equal(allocatedMeasureWidthOsmd(gm(10, 40), gm(50, 30)), 40);

// Size.width≤0 → 다음 마디 간격 사용 (SkyBottomLine 실패 복구)
assert.equal(allocatedMeasureWidthOsmd(gm(10, -14), gm(50, -10)), 40);
assert.equal(allocatedMeasureWidthOsmd(gm(5, 0), gm(33, 0)), 28);

// 다음 마디가 없거나 역순이면 Size/fallback
assert.equal(allocatedMeasureWidthOsmd(gm(10, 22), undefined), 22);
assert.equal(allocatedMeasureWidthOsmd(gm(50, -5), gm(10, 20)), 28);

console.log('test_allocated_measure_width_clip: OK');
