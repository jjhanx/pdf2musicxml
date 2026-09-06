/**
 * staff-space px 파싱 + shift 크기.
 * Run: npx tsx _smoke/test_articulation_preview_shift.ts
 */
import {
  ARTICULATION_STAFF_GAP_BASE,
  articulationDefaultYFromStaffSpaces,
  articulationPreviewShiftPx,
  articulationStaffSpacesFromHint,
  parseArticulationStaffSpaces,
} from '../shared/musicXmlArticulationDistance';
import { staffLineGapPxFromYs, staffLineYsFromSvg } from '../src/osmdArticulationOffsetFix';
import { JSDOM } from 'jsdom';

const staffSpacePx = 10;

const autoBelow = articulationPreviewShiftPx(1, staffSpacePx);
const veryFarBelow = articulationPreviewShiftPx(5, staffSpacePx);
const fiveBelow = articulationPreviewShiftPx(5, staffSpacePx);

if (autoBelow >= veryFarBelow) {
  throw new Error(`auto(${autoBelow}) must be less than very-far(${veryFarBelow})`);
}
if (autoBelow !== 10 || veryFarBelow !== 50 || fiveBelow !== 50) {
  throw new Error(`shift px wrong: auto=${autoBelow} very=${veryFarBelow} five=${fiveBelow}`);
}

if (parseArticulationStaffSpaces('5') !== 5) throw new Error('parse 5');
if (articulationStaffSpacesFromHint('very-far', null) !== 5) throw new Error('very-far spaces');

const autoDy = articulationDefaultYFromStaffSpaces('below', 1);
if (autoDy !== -ARTICULATION_STAFF_GAP_BASE) {
  throw new Error(`auto dy -10 expected, got ${autoDy}`);
}

const dom = new JSDOM(
  '<svg><g class="staffline"><path d="M0 50 L100 50"/><path d="M0 60 L100 60"/><path d="M0 70 L100 70"/></g></svg>',
);
const doc = dom.window.document;
const gap = staffLineGapPxFromYs(staffLineYsFromSvg(doc));
if (gap !== 10) throw new Error(`staff line gap should be 10, got ${gap}`);

console.log('articulation preview shift ok', { autoBelow, veryFarBelow, fiveBelow, gap });
