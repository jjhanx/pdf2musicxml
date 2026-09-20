/**
 * 화음 slur bezier — 각 음머리 중심 X에 맞추고, 화음 전체 고정 headShift 금지.
 * Run: npx tsx _smoke/test_chord_slur_notehead_x.ts
 */
import assert from 'node:assert/strict';
import {
  bezierDeltasToNoteheads,
  noteheadCenterX,
  prepareGraphicalSlursForOsmdPreview,
  voiceEntryIsChord,
} from '../src/osmdChordSlurFix';

const PLACEMENT_ABOVE = 0;
const STEM_UP = 0;
const STEM_DOWN = 1;

function gNote(x: number, y: number, borderLeft = -0.5, borderRight = 0.5) {
  return {
    PositionAndShape: {
      AbsolutePosition: { x, y },
      BorderTop: -0.4,
      BorderBottom: 0.4,
      BorderLeft: borderLeft,
      BorderRight: borderRight,
      calculateAbsolutePosition() {},
    },
  };
}

{
  // 중심 = x + (left+right)/2
  assert.equal(noteheadCenterX(gNote(10, 0, -1, 1)), 10);
  assert.equal(noteheadCenterX(gNote(10, 0, 0, 2)), 11); // 오른쪽으로 이격된 머리
}

{
  const a = {
    ParentVoiceEntry: { StemDirection: STEM_DOWN, Notes: [{}, {}] },
  } as any;
  const b = {
    ParentVoiceEntry: { StemDirection: STEM_UP, Notes: [{}] },
  } as any;
  assert.equal(voiceEntryIsChord(a), true);
  assert.equal(voiceEntryIsChord(b), false);
}

{
  // 끝 화음만 오른쪽 이격 — 각 slur가 자기 머리 X로 (고정 -0.42 unit 아님)
  const start = gNote(20, 5);
  const endLeft = gNote(40, 5, -0.5, 0.5);
  const endRight = gNote(44, 5, -0.5, 0.5); // 같은 화음, 오른쪽 머리
  const slurLeft = {
    bezierStartPt: { x: 22, y: 4 },
    bezierEndPt: { x: 42, y: 4 },
  };
  const slurRight = {
    bezierStartPt: { x: 22, y: 4 },
    bezierEndPt: { x: 42, y: 4 }, // OSMD가 화음 공통 X로 둔 상태
  };
  const dL = bezierDeltasToNoteheads(slurLeft, start, endLeft, PLACEMENT_ABOVE, 0.2);
  const dR = bezierDeltasToNoteheads(slurRight, start, endRight, PLACEMENT_ABOVE, 0.2);
  assert.ok(Math.abs(dL.dxEnd) < Math.abs(dR.dxEnd) || dR.dxEnd > 0.5, 'right head needs +dx');
  assert.ok(dR.dxEnd > dL.dxEnd, `right dx ${dR.dxEnd} > left dx ${dL.dxEnd}`);
  // 적용 후 끝점이 각 머리 중심
  assert.ok(Math.abs(42 + dL.dxEnd - noteheadCenterX(endLeft)) < 1e-6);
  assert.ok(Math.abs(42 + dR.dxEnd - noteheadCenterX(endRight)) < 1e-6);
}

{
  // prepare: stem-down 화음도 X 재정렬 (예전엔 stem-up만)
  const n1: any = { ParentVoiceEntry: null as any };
  const n2: any = { ParentVoiceEntry: null as any };
  const n3: any = { ParentVoiceEntry: null as any };
  const n4: any = { ParentVoiceEntry: null as any };
  const veStart = { StemDirection: STEM_DOWN, Notes: [n1, n2] };
  const veEnd = { StemDirection: STEM_DOWN, Notes: [n3, n4] };
  n1.ParentVoiceEntry = veStart;
  n2.ParentVoiceEntry = veStart;
  n3.ParentVoiceEntry = veEnd;
  n4.ParentVoiceEntry = veEnd;

  const gStart = gNote(10, 8);
  const gEnd = gNote(30, 8, 0, 2); // 오른쪽 치우친 머리
  const gSlur: any = {
    slur: { StartNote: n1, EndNote: n3, PlacementXml: PLACEMENT_ABOVE },
    placement: PLACEMENT_ABOVE,
    bezierStartPt: { x: 12, y: 7 },
    bezierStartControlPt: { x: 16, y: 6 },
    bezierEndControlPt: { x: 24, y: 6 },
    bezierEndPt: { x: 28, y: 7 },
  };
  const noteMap = new Map<any, any>([
    [n1, gStart],
    [n3, gEnd],
  ]);
  const osmd: any = {
    EngravingRules: {
      unit: 10,
      SlurNoteHeadYOffset: 0.2,
      GNote: (n: any) => {
        const g = noteMap.get(n);
        if (!g) throw new Error('no gnote');
        return g;
      },
    },
    GraphicSheet: {
      MusicPages: [{ MusicSystems: [{ StaffLines: [{ GraphicalSlurs: [gSlur] }] }] }],
    },
  };
  prepareGraphicalSlursForOsmdPreview(osmd);
  assert.ok(
    Math.abs(gSlur.bezierEndPt.x - noteheadCenterX(gEnd)) < 0.05,
    `end x ${gSlur.bezierEndPt.x} vs head ${noteheadCenterX(gEnd)}`,
  );
  assert.ok(
    Math.abs(gSlur.bezierStartPt.x - noteheadCenterX(gStart)) < 0.05,
    `start x ${gSlur.bezierStartPt.x}`,
  );
}

console.log('ok chord slur notehead x');
