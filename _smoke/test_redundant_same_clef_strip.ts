/**
 * Same-content mid/end clef stripped; real F↔G mid change kept.
 * Run: npx tsx _smoke/test_redundant_same_clef_strip.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { removeRedundantCourtesyClefsForOsmd } from '../shared/musicXmlCourtesyClef.ts';
import { anchorTrailingMidClefsForOsmdPreview } from '../shared/musicXmlMidClefOsmdAnchor.ts';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const SAME_TRAILING = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
    </measure>
  </part>
</score-partwise>`;

const REAL_MID_CHANGE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const HEADER_REPEAT = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <attributes><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

function clefSigns(xml: string): string[] {
  return [...xml.matchAll(/<sign>([^<]*)<\/sign>/g)].map((m) => m[1]!);
}

{
  const stripped = removeRedundantCourtesyClefsForOsmd(SAME_TRAILING);
  assert.deepEqual(clefSigns(stripped), ['G'], 'trailing same G must be removed');
  const anchored = anchorTrailingMidClefsForOsmdPreview(stripped);
  assert.ok(!anchored.includes('print-object="no"'), 'no anchor for stripped same clef');
}

{
  const out = removeRedundantCourtesyClefsForOsmd(REAL_MID_CHANGE);
  assert.deepEqual(clefSigns(out), ['F', 'G'], 'real mid F→G must survive');
}

{
  const out = removeRedundantCourtesyClefsForOsmd(HEADER_REPEAT);
  assert.deepEqual(clefSigns(out), ['G'], 'm2 header courtesy G removed');
}

console.log('ok');
