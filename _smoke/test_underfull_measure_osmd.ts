/** repairUnderfullMeasuresForOsmdPreview — timeline padding + click target regression */
import { JSDOM } from 'jsdom';
import {
  measureTimelineEndDivisions,
  repairUnderfullMeasuresForOsmdPreview,
} from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { parseMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { collectMeasureHitTargets } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:900px;height:2000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const underfull = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const doc = parseMusicXmlDocument(underfull)!;
const m = doc.querySelector('measure')!;
if (measureTimelineEndDivisions(m) !== 12) throw new Error('fixture must be 12/16 before repair');

const repaired = repairUnderfullMeasuresForOsmdPreview(underfull);
const m2 = parseMusicXmlDocument(repaired)!.querySelector('measure')!;
if (measureTimelineEndDivisions(m2) !== 16) throw new Error('after repair timeline must be 16/16');
if (!repaired.includes('<forward')) throw new Error('must append forward at measure end');

async function main() {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(repaired);
  osmd.render();

  const targets = collectMeasureHitTargets(osmd, host);
  const m1 = targets.filter((t) => t.measureMxl === 1);
  if (!m1.length) throw new Error('measure 1 must have click targets after underfull repair');
  const w = m1[0]!.bounds.right - m1[0]!.bounds.left;
  if (w < 8) throw new Error(`click target width too small: ${w}`);
  console.log('ok underfull repair: timeline 16/16, forward appended, click w=', w.toFixed(1));
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
