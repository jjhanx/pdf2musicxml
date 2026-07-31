import { JSDOM } from 'jsdom';
import { repairUnderfullMeasuresForOsmdPreview, measureTimelineEndDivisions } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { parseMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

/** 4/4, divisions=4, 3 quarter notes = 12/16 (missing first beat) */
const xml = `<?xml version="1.0"?>
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

const doc = parseMusicXmlDocument(xml)!;
const m = doc.querySelector('measure')!;
console.log('before end', measureTimelineEndDivisions(m), '/ 16');
const out = repairUnderfullMeasuresForOsmdPreview(xml);
const doc2 = parseMusicXmlDocument(out)!;
const m2 = doc2.querySelector('measure')!;
console.log('after end', measureTimelineEndDivisions(m2), '/ 16');
console.log('has forward', out.includes('<forward'));

async function osmdWidth(label: string, x: string) {
  const dom2 = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
  Object.assign(globalThis, {
    document: dom2.window.document,
    window: dom2.window,
    DOMParser: dom2.window.DOMParser,
    XMLSerializer: dom2.window.XMLSerializer,
    Node: dom2.window.Node,
    Element: dom2.window.Element,
    HTMLElement: dom2.window.HTMLElement,
    SVGElement: dom2.window.SVGElement,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 0;
    },
  });
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(x);
  osmd.render();
  const sheet = (osmd as unknown as Record<string, unknown>).GraphicSheet as {
    MeasureList?: Record<string, unknown>[][];
  };
  const gm = sheet?.MeasureList?.[0]?.[0] as Record<string, unknown> | undefined;
  const bb = gm?.PositionAndShape ?? gm?.positionAndShape;
  const size = (bb as Record<string, unknown>)?.Size ?? (bb as Record<string, unknown>)?.size;
  const w = Number((size as Record<string, unknown>)?.width ?? 0);
  const entries = (gm?.staffEntries ?? gm?.StaffEntries) as unknown[] | undefined;
  console.log(label, 'graphicW', w, 'staffEntries', entries?.length ?? 0);
}

void (async () => {
  await osmdWidth('raw underfull 12/16', xml);
  await osmdWidth('repaired 16/16', out);
})();
