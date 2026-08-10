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
