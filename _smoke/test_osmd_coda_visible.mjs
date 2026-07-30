/**
 * After OSMD patch: Coda must remain visible even when To Coda already exists.
 * Run: node _smoke/test_osmd_coda_visible.mjs
 */
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const { OpenSheetMusicDisplay, RepetitionInstructionEnum } = require('opensheetmusicdisplay');

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <direction placement="above">
        <direction-type><words>To Coda</words></direction-type>
        <direction-type><coda/></direction-type>
        <sound tocoda="coda"/>
      </direction>
    </measure>
    <measure number="2">
      <direction placement="above">
        <direction-type><words>Coda</words></direction-type>
        <direction-type><coda/></direction-type>
      </direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

const codaOnly = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <direction placement="above"><direction-type><coda/></direction-type></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

async function load(xmlStr) {
  const dom = new JSDOM('<!DOCTYPE html><div id="h"></div>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.SVGElement = dom.window.SVGElement;
  global.DOMParser = dom.window.DOMParser;
  global.Node = dom.window.Node;
  const osmd = new OpenSheetMusicDisplay(document.getElementById('h'), {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
  });
  await osmd.load(xmlStr);
  return osmd;
}

function hasCoda(measure) {
  const Coda = RepetitionInstructionEnum.Coda;
  const all = [
    ...(measure.FirstRepetitionInstructions || []),
    ...(measure.LastRepetitionInstructions || []),
  ];
  return all.some((x) => x.type === Coda);
}

const a = await load(xml);
const m2 = a.Sheet.SourceMeasures[1];
if (!hasCoda(m2)) {
  console.error('FAIL: Coda missing after To Coda', {
    first: m2.FirstRepetitionInstructions.map((x) => x.type),
    last: m2.LastRepetitionInstructions.map((x) => x.type),
  });
  process.exit(1);
}

const b = await load(codaOnly);
const m2b = b.Sheet.SourceMeasures[1];
if (!hasCoda(m2b)) {
  console.error('FAIL: standalone Coda missing', {
    first: m2b.FirstRepetitionInstructions.map((x) => x.type),
    last: m2b.LastRepetitionInstructions.map((x) => x.type),
  });
  process.exit(1);
}

console.log('osmd coda visible ok');
