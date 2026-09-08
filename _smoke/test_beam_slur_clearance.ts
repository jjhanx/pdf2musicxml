/**
 * 빔·이음줄 이격 — placement/dy 순수 규칙.
 * Run: npx tsx _smoke/test_beam_slur_clearance.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  BEAM_SLUR_CLEARANCE_STAFF_SPACES,
  beamSlurClearanceDy,
  prepareGraphicalSlursForOsmdPreview,
  slurPlacementOnStemSide,
} from '../src/osmdChordSlurFix';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

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

function makeSlur(y: number) {
  const start: any = {
    NoteBeam: {},
    ParentVoiceEntry: { StemDirection: STEM_UP, Notes: [] as any[] },
  };
  const end: any = {
    NoteBeam: {},
    ParentVoiceEntry: { StemDirection: STEM_UP, Notes: [] as any[] },
  };
  start.ParentVoiceEntry.Notes = [start];
  end.ParentVoiceEntry.Notes = [end];
  return {
    slur: { StartNote: start, EndNote: end, PlacementXml: PLACEMENT_ABOVE },
    placement: PLACEMENT_ABOVE,
    bezierStartPt: { x: 0, y },
    bezierStartControlPt: { x: 1, y },
    bezierEndControlPt: { x: 2, y },
    bezierEndPt: { x: 3, y },
  };
}

const hinted = makeSlur(100);
const automatic = makeSlur(100);
const osmd: any = {
  EngravingRules: { unit: 10 },
  GraphicSheet: {
    MusicPages: [
      {
        MusicSystems: [
          {
            StaffLines: [
              {
                GraphicalSlurs: [hinted, automatic],
              },
            ],
          },
        ],
      },
    ],
  },
};

prepareGraphicalSlursForOsmdPreview(osmd);
assert.equal(hinted.bezierStartPt.y, 90);
assert.equal(automatic.bezierStartPt.y, 90);

prepareGraphicalSlursForOsmdPreview(osmd);
assert.equal(hinted.bezierStartPt.y, 90);
assert.equal(automatic.bezierStartPt.y, 90);

console.log('beam slur clearance ok');
