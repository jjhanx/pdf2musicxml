/**
 * OSMD(VexFlow) 진행 제어 라벨·기호 패치 (특정 곡 아님).
 * - TO_CODA: "To"+코다 → "To Coda"+코다
 * - DS: "D.S."만 → "D.S."+Segno 기호(v8c)
 * - Coda: To Coda가 있어도 / openRepetition 없어도 마디 처음에 Coda 기호 표시
 * npm install 후 postinstall에서 실행.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(
  root,
  'node_modules',
  'opensheetmusicdisplay',
  'build',
  'opensheetmusicdisplay.min.js',
);

const CODA_CALC_FROM =
  'case n.RepetitionInstructionEnum.Coda:if(0===this.openRepetitions.length)break;e=this.getOrCreateCurrentRepetition2(!0),t.parentRepetition=e.RepetitonUnderConstruction,e.WaitingForCoda?(e.CodaFound=!0,e.RepetitonUnderConstruction.setEndingStartIndex(2,this.currentMeasureIndex),this.currentMeasure.LastRepetitionInstructions.push(t),this.finalizeRepetition(e),this.currentMeasureIndex>0&&(this.musicSheet.SourceMeasures[this.currentMeasureIndex-1].printNewSystemXml=!0)):e.ToCodaFound||(0===e.RepetitonUnderConstruction.BackwardJumpInstructions.length?(e.ToCodaFound=!0,e.RepetitonUnderConstruction.forwardJumpInstruction=new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.ToCoda,n.AlignmentType.End,e.RepetitonUnderConstruction),this.currentMeasure.LastRepetitionInstructions.push(e.RepetitonUnderConstruction.forwardJumpInstruction)):this.currentMeasure.LastRepetitionInstructions.push(new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.Coda,n.AlignmentType.Begin,void 0)));break;';

const CODA_CALC_TO =
  'case n.RepetitionInstructionEnum.Coda:if(0===this.openRepetitions.length){this.currentMeasure.FirstRepetitionInstructions.push(new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.Coda,n.AlignmentType.Begin,void 0));break}e=this.getOrCreateCurrentRepetition2(!0),t.parentRepetition=e.RepetitonUnderConstruction,e.WaitingForCoda?(e.CodaFound=!0,e.RepetitonUnderConstruction.setEndingStartIndex(2,this.currentMeasureIndex),this.currentMeasure.FirstRepetitionInstructions.push(new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.Coda,n.AlignmentType.Begin,void 0)),this.finalizeRepetition(e),this.currentMeasureIndex>0&&(this.musicSheet.SourceMeasures[this.currentMeasureIndex-1].printNewSystemXml=!0)):(this.currentMeasure.FirstRepetitionInstructions.push(new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.Coda,n.AlignmentType.Begin,void 0)),e.ToCodaFound||(0===e.RepetitonUnderConstruction.BackwardJumpInstructions.length&&(e.ToCodaFound=!0,e.RepetitonUnderConstruction.forwardJumpInstruction=new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.ToCoda,n.AlignmentType.End,e.RepetitonUnderConstruction),this.currentMeasure.LastRepetitionInstructions.push(e.RepetitonUnderConstruction.forwardJumpInstruction))));break;';

/** @type {{ name: string, from: string, to: string }[]} */
const PATCHES = [
  {
    name: 'TO_CODA label',
    from: 'TO_CODA:this.drawSymbolText(t,e,"To",!0)',
    to: 'TO_CODA:this.drawSymbolText(t,e,"To Coda",!0)',
  },
  {
    name: 'DS draw segno glyph flag',
    from: 'type.DS:this.drawSymbolText(t,e,"D.S.",!1)',
    to: 'type.DS:this.drawSymbolText(t,e,"D.S.",!0)',
  },
  {
    name: 'DS uses segno glyph not coda',
    from: 's&&f.renderGlyph(n,o,a,40,"v4d",!0)',
    to: 's&&f.renderGlyph(n,o,a,40,this.symbol_type===pt.type.DS?"v8c":"v4d",!0)',
  },
  {
    name: 'Coda always visible (calculator)',
    from: CODA_CALC_FROM,
    to: CODA_CALC_TO,
  },
  {
    name: 'Coda not stripped after ToCoda',
    from: 'case s.RepetitionInstructionEnum.Coda:i>0&&this.findInstructionInPreviousMeasure(n,o.measureIndex,s.RepetitionInstructionEnum.ToCoda)&&(o.type=s.RepetitionInstructionEnum.None);break;',
    to: 'case s.RepetitionInstructionEnum.Coda:break;',
  },
  {
    name: 'Prevent crash on missing activeKeys',
    from: 'h||(h=r.KeyInstruction.copy(this.activeKeys[i]))',
    to: 'h||(this.activeKeys[i]&&(h=r.KeyInstruction.copy(this.activeKeys[i])))',
  },
  {
    name: 'Dynamic expression above vertical spacing',
    from: 'else a=i-t.PositionAndShape.BorderMarginBottom;t.PositionAndShape.RelativePosition=new f.PointF2D(e.x,a)}',
    to: 'else a=i-t.PositionAndShape.BorderMarginBottom-3.8;t.PositionAndShape.RelativePosition=new f.PointF2D(e.x,a)}',
  },
  {
    name: 'Dynamic expression multi-staff above vertical spacing',
    from: 'a=i>-n/2?-n/2:i-t.PositionAndShape.BorderMarginBottom',
    to: 'a=i>-n/2?-n/2:i-t.PositionAndShape.BorderMarginBottom-3.8',
  },
  {
    name: 'Dynamic expression below vertical spacing',
    from: 'else a=i-t.PositionAndShape.BorderMarginTop;t.PositionAndShape.RelativePosition=new f.PointF2D(e.x,a)}',
    to: 'else a=i-t.PositionAndShape.BorderMarginTop+2.5;t.PositionAndShape.RelativePosition=new f.PointF2D(e.x,a)}',
  },
  {
    name: 'Wedge deduplication measure comparison fix',
    from: 'this.lastWedge.parentMeasure.MeasureNumberXML===i.MeasureNumberXML',
    to: 'this.lastWedge.parentMeasure===i',
  },
];

if (!fs.existsSync(target)) {
  console.warn('[patch_osmd_navigation_labels] OSMD min.js 없음 — skip');
  process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');
let changed = 0;
for (const p of PATCHES) {
  if (src.includes(p.to)) {
    console.log(`[patch_osmd_navigation_labels] ${p.name}: already patched`);
    continue;
  }
  if (!src.includes(p.from)) {
    console.warn(`[patch_osmd_navigation_labels] ${p.name}: 패턴 없음 — OSMD 버전 확인`);
    continue;
  }
  src = src.replace(p.from, p.to);
  changed += 1;
  console.log(`[patch_osmd_navigation_labels] ${p.name}: ok`);
}

if (changed > 0) {
  fs.writeFileSync(target, src, 'utf8');
  console.log(`[patch_osmd_navigation_labels] wrote ${changed} patch(es)`);
} else {
  console.log('[patch_osmd_navigation_labels] all patches up to date');
}
