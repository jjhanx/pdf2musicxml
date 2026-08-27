/**
 * mid-measure G clef must survive removeRedundantCourtesyClefsForOsmd
 * (default/previous G used to strip mid G → invisible in OSMD preview).
 *
 * Run: npx tsx _smoke/test_mid_clef_survives_courtesy_strip.ts
 */
import { removeRedundantCourtesyClefsForOsmd } from '../shared/musicXmlCourtesyClef';

const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

function main() {
  const out = removeRedundantCourtesyClefsForOsmd(SAMPLE);
  const midG = /<note>[\s\S]*?<attributes>[\s\S]*?<sign>G<\/sign>[\s\S]*?<\/attributes>/;
  if (!midG.test(out)) {
    throw new Error(`mid G clef stripped from preview XML:\n${out}`);
  }
  // Header F must remain
  if (!/<attributes>[\s\S]*?<sign>F<\/sign>[\s\S]*?<\/attributes>[\s\S]*?<note>/.test(out)) {
    throw new Error(`header F lost:\n${out}`);
  }
  console.log('mid_clef_survives_courtesy_strip ok');
}

main();
