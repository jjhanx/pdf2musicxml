import fs from 'fs';
import { JSDOM } from 'jsdom';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
<part-list><score-part id="P1"><part-name/></score-part></part-list>
<part id="P1"><measure number="1">
<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note>
  <pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>
  <stem>down</stem><staff>1</staff><beam number="1">begin</beam>
  <notations><tied type="stop"/></notations>
</note>
<note>
  <chord/><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>
  <stem>down</stem><staff>1</staff>
</note>
<note>
  <pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>
  <stem>down</stem><staff>1</staff><beam number="1">end</beam>
</note>
<note>
  <chord/><pitch><step>B</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>
  <stem>down</stem><staff>1</staff>
</note>
</measure></part></score-partwise>`;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="osmd"></div></body></html>', {
  pretendToBeVisual: true,
  resources: 'usable',
});
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.Node = dom.window.Node;
global.XMLSerializer = dom.window.XMLSerializer;
global.DOMParser = dom.window.DOMParser;

const host = document.getElementById('osmd');
const osmd = new OpenSheetMusicDisplay(host, { backend: 'svg', autoResize: false });
await osmd.load(xml);
osmd.render();

const svg = host.innerHTML;
const beamPaths = (svg.match(/class="[^"]*beam[^"]*"/gi) || []).length;
const vfBeams = (svg.match(/vf-beam/g) || []).length;
console.log('svg length', svg.length);
console.log('beam class matches', beamPaths, 'vf-beam', vfBeams);
if (vfBeams === 0 && beamPaths === 0) {
  console.error('NO BEAMS RENDERED');
  process.exit(1);
}
console.log('beams rendered ok');
