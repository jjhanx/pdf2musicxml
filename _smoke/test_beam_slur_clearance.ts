/**
 * 빔·이음줄 이격 — placement/dy 순수 규칙.
 * Run: npx tsx _smoke/test_beam_slur_clearance.ts
 */
import assert from 'node:assert/strict';
import {
  BEAM_SLUR_CLEARANCE_STAFF_SPACES,
  beamSlurClearanceDy,
  slurPlacementOnStemSide,
} from '../src/osmdChordSlurFix';

const PLACEMENT_ABOVE = 0;
const PLACEMENT_BELOW = 1;
const STEM_UP = 0;
const STEM_DOWN = 1;

assert.equal(BEAM_SLUR_CLEARANCE_STAFF_SPACES, 1);
assert.equal(beamSlurClearanceDy(PLACEMENT_ABOVE, 10), -10);
assert.equal(beamSlurClearanceDy(PLACEMENT_BELOW, 10), 10);
assert.equal(beamSlurClearanceDy(PLACEMENT_ABOVE, 10, 1.5), -15);

assert.equal(slurPlacementOnStemSide(STEM_UP, PLACEMENT_ABOVE), true);
assert.equal(slurPlacementOnStemSide(STEM_UP, PLACEMENT_BELOW), false);
assert.equal(slurPlacementOnStemSide(STEM_DOWN, PLACEMENT_BELOW), true);
assert.equal(slurPlacementOnStemSide(STEM_DOWN, PLACEMENT_ABOVE), false);
assert.equal(slurPlacementOnStemSide(undefined, PLACEMENT_ABOVE), false);

console.log('beam slur clearance ok');
