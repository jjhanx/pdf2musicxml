import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const CODA_CALC_FROM =
  'case n.RepetitionInstructionEnum.Coda:if(0===this.openRepetitions.length)break;e=this.getOrCreateCurrentRepetition2(!0),t.parentRepetition=e.RepetitonUnderConstruction,e.WaitingForCoda?(e.CodaFound=!0,e.RepetitonUnderConstruction.setEndingStartIndex(2,this.currentMeasureIndex),this.currentMeasure.LastRepetitionInstructions.push(t),this.finalizeRepetition(e),this.currentMeasureIndex>0&&(this.musicSheet.SourceMeasures[this.currentMeasureIndex-1].printNewSystemXml=!0)):e.ToCodaFound||(0===e.RepetitonUnderConstruction.BackwardJumpInstructions.length?(e.ToCodaFound=!0,e.RepetitonUnderConstruction.forwardJumpInstruction=new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.ToCoda,n.AlignmentType.End,e.RepetitonUnderConstruction),this.currentMeasure.LastRepetitionInstructions.push(e.RepetitonUnderConstruction.forwardJumpInstruction)):this.currentMeasure.LastRepetitionInstructions.push(new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.Coda,n.AlignmentType.Begin,void 0)));break;';

const CODA_CALC_TO =
  'case n.RepetitionInstructionEnum.Coda:if(0===this.openRepetitions.length){this.currentMeasure.FirstRepetitionInstructions.push(new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.Coda,n.AlignmentType.Begin,void 0));break}e=this.getOrCreateCurrentRepetition2(!0),t.parentRepetition=e.RepetitonUnderConstruction,e.WaitingForCoda?(e.CodaFound=!0,e.RepetitonUnderConstruction.setEndingStartIndex(2,this.currentMeasureIndex),this.currentMeasure.FirstRepetitionInstructions.push(new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.Coda,n.AlignmentType.Begin,void 0)),this.finalizeRepetition(e),this.currentMeasureIndex>0&&(this.musicSheet.SourceMeasures[this.currentMeasureIndex-1].printNewSystemXml=!0)):(this.currentMeasure.FirstRepetitionInstructions.push(new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.Coda,n.AlignmentType.Begin,void 0)),e.ToCodaFound||(0===e.RepetitonUnderConstruction.BackwardJumpInstructions.length&&(e.ToCodaFound=!0,e.RepetitonUnderConstruction.forwardJumpInstruction=new n.RepetitionInstruction(this.currentMeasureIndex,n.RepetitionInstructionEnum.ToCoda,n.AlignmentType.End,e.RepetitonUnderConstruction),this.currentMeasure.LastRepetitionInstructions.push(e.RepetitonUnderConstruction.forwardJumpInstruction))));break;';

/** OSMD/VexFlow 진행 제어 — postinstall 패치와 동일 규칙. */
function osmdNavigationLabelPlugin(): Plugin {
  const patches: [string, string][] = [
    ['TO_CODA:this.drawSymbolText(t,e,"To",!0)', 'TO_CODA:this.drawSymbolText(t,e,"To Coda",!0)'],
    ['type.DS:this.drawSymbolText(t,e,"D.S.",!1)', 'type.DS:this.drawSymbolText(t,e,"D.S.",!0)'],
    [
      's&&f.renderGlyph(n,o,a,40,"v4d",!0)',
      's&&f.renderGlyph(n,o,a,40,this.symbol_type===pt.type.DS?"v8c":"v4d",!0)',
    ],
    [CODA_CALC_FROM, CODA_CALC_TO],
    [
      'case s.RepetitionInstructionEnum.Coda:i>0&&this.findInstructionInPreviousMeasure(n,o.measureIndex,s.RepetitionInstructionEnum.ToCoda)&&(o.type=s.RepetitionInstructionEnum.None);break;',
      'case s.RepetitionInstructionEnum.Coda:break;',
    ],
    [
      'h||(h=r.KeyInstruction.copy(this.activeKeys[i]))',
      'h||(this.activeKeys[i]&&(h=r.KeyInstruction.copy(this.activeKeys[i])))'
    ],
    [
      'else a=i-t.PositionAndShape.BorderMarginBottom;t.PositionAndShape.RelativePosition=new f.PointF2D(e.x,a)}',
      'else a=i-t.PositionAndShape.BorderMarginBottom-3.8;t.PositionAndShape.RelativePosition=new f.PointF2D(e.x,a)}',
    ],
    [
      'a=i>-n/2?-n/2:i-t.PositionAndShape.BorderMarginBottom',
      'a=i>-n/2?-n/2:i-t.PositionAndShape.BorderMarginBottom-3.8',
    ],
    [
      'else a=i-t.PositionAndShape.BorderMarginTop;t.PositionAndShape.RelativePosition=new f.PointF2D(e.x,a)}',
      'else a=i-t.PositionAndShape.BorderMarginTop+2.5;t.PositionAndShape.RelativePosition=new f.PointF2D(e.x,a)}',
    ],
    [
      'this.lastWedge.parentMeasure.MeasureNumberXML===i.MeasureNumberXML',
      'this.lastWedge.parentMeasure===i',
    ],
    [
      'O=this.rules.StaffHeight+t/2}else O=this.rules.WedgePlacementBelowY',
      'O=this.rules.WedgePlacementBelowY}else O=this.rules.WedgePlacementBelowY',
    ],
    // 긴 hairpin이 고정 opening으로 직선처럼 보이는 문제 — 길이 비례 벌어짐
    [
      'createCrescendoLines(t,e,i,s=this.rules.WedgeOpeningLength,n=this.rules.WedgeLineWidth){const r=new o.PointF2D(t,i),a=new o.PointF2D(e,i-s/2),l=new o.PointF2D(e,i+s/2);this.addWedgeLines(r,a,l,n)}',
      'createCrescendoLines(t,e,i,s=this.rules.WedgeOpeningLength,n=this.rules.WedgeLineWidth){const _o=Math.max(s,Math.min(Math.abs(e-t)*.5,14)),r=new o.PointF2D(t,i),a=new o.PointF2D(e,i-_o/2),l=new o.PointF2D(e,i+_o/2);this.addWedgeLines(r,a,l,n)}',
    ],
    [
      'createDiminuendoLines(t,e,i,s=this.rules.WedgeOpeningLength,n=this.rules.WedgeLineWidth){const r=new o.PointF2D(t,i-s/2),a=new o.PointF2D(t,i+s/2),l=new o.PointF2D(e,i);this.addWedgeLines(l,r,a,n)}',
      'createDiminuendoLines(t,e,i,s=this.rules.WedgeOpeningLength,n=this.rules.WedgeLineWidth){const _o=Math.max(s,Math.min(Math.abs(e-t)*.5,14)),r=new o.PointF2D(t,i-_o/2),a=new o.PointF2D(t,i+_o/2),l=new o.PointF2D(e,i);this.addWedgeLines(l,r,a,n)}',
    ],
    [
      'createFirstHalfCrescendoLines(t,e,i,s=this.rules.WedgeMeasureEndOpeningLength,n=this.rules.WedgeLineWidth){const r=new o.PointF2D(t,i),a=new o.PointF2D(e,i-s/2),l=new o.PointF2D(e,i+s/2);this.addWedgeLines(r,a,l,n)}',
      'createFirstHalfCrescendoLines(t,e,i,s=this.rules.WedgeMeasureEndOpeningLength,n=this.rules.WedgeLineWidth){const _o=Math.max(s,Math.min(Math.abs(e-t)*.5,10)),r=new o.PointF2D(t,i),a=new o.PointF2D(e,i-_o/2),l=new o.PointF2D(e,i+_o/2);this.addWedgeLines(r,a,l,n)}',
    ],
    [
      'createSecondHalfDiminuendoLines(t,e,i,s=this.rules.WedgeMeasureBeginOpeningLength,n=this.rules.WedgeLineWidth){const r=new o.PointF2D(t,i-s/2),a=new o.PointF2D(t,i+s/2),l=new o.PointF2D(e,i);this.addWedgeLines(l,r,a,n)}',
      'createSecondHalfDiminuendoLines(t,e,i,s=this.rules.WedgeMeasureBeginOpeningLength,n=this.rules.WedgeLineWidth){const _o=Math.max(s,Math.min(Math.abs(e-t)*.5,10)),r=new o.PointF2D(t,i-_o/2),a=new o.PointF2D(t,i+_o/2),l=new o.PointF2D(e,i);this.addWedgeLines(l,r,a,n)}',
    ],
    [
      'createSecondHalfCrescendoLines(t,e,i,s=this.rules.WedgeMeasureBeginOpeningLength,n=this.rules.WedgeOpeningLength,r=this.rules.WedgeLineWidth){const a=new o.PointF2D(t,i-s/2),l=new o.PointF2D(t,i+s/2),h=new o.PointF2D(e,i-n/2),c=new o.PointF2D(e,i+n/2);this.addDoubleLines(a,h,l,c,r)}',
      'createSecondHalfCrescendoLines(t,e,i,s=this.rules.WedgeMeasureBeginOpeningLength,n=this.rules.WedgeOpeningLength,r=this.rules.WedgeLineWidth){const _len=Math.abs(e-t),_n=Math.max(n,Math.min(_len*.5,14)),_s=Math.max(s,Math.min(_n*.45,8)),a=new o.PointF2D(t,i-_s/2),l=new o.PointF2D(t,i+_s/2),h=new o.PointF2D(e,i-_n/2),c=new o.PointF2D(e,i+_n/2);this.addDoubleLines(a,h,l,c,r)}',
    ],
    [
      'createFirstHalfDiminuendoLines(t,e,i,s=this.rules.WedgeOpeningLength,n=this.rules.WedgeMeasureEndOpeningLength,r=this.rules.WedgeLineWidth){const a=new o.PointF2D(t,i-s/2),l=new o.PointF2D(t,i+s/2),h=new o.PointF2D(e,i-n/2),c=new o.PointF2D(e,i+n/2);this.addDoubleLines(a,h,l,c,r)}',
      'createFirstHalfDiminuendoLines(t,e,i,s=this.rules.WedgeOpeningLength,n=this.rules.WedgeMeasureEndOpeningLength,r=this.rules.WedgeLineWidth){const _len=Math.abs(e-t),_s=Math.max(s,Math.min(_len*.5,14)),_n=Math.max(n,Math.min(_s*.45,8)),a=new o.PointF2D(t,i-_s/2),l=new o.PointF2D(t,i+_s/2),h=new o.PointF2D(e,i-_n/2),c=new o.PointF2D(e,i+_n/2);this.addDoubleLines(a,h,l,c,r)}',
    ],
  ];
  return {
    name: 'osmd-navigation-labels',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('opensheetmusicdisplay')) return;
      let next = code;
      let hit = false;
      for (const [from, to] of patches) {
        if (next.includes(from)) {
          next = next.replace(from, to);
          hit = true;
        }
      }
      if (!hit) return;
      return { code: next, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), osmdNavigationLabelPlugin()],
  optimizeDeps: {
    include: ['opensheetmusicdisplay'],
  },
  server: {
    host: true,
    port: 5173,
    // Windows: omr-work ZIP 등이 열려 있으면 chokidar watch → EBUSY로 Vite가 죽음
    watch: {
      ignored: [
        '**/omr-work*.zip',
        '**/*.mxl',
        '**/_smoke/**',
        '**/_pip_wheels/**',
        '**/venv/**',
        '**/venv.broken.*/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 5173,
  },
});
