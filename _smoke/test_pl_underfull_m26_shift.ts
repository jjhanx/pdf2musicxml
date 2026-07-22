/**
 * PL 12/16 underfull m26 — OSMD must keep m26 column (not skip to m27 shift)
 */
import { JSDOM } from 'jsdom';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { forEachOsmdSystem, measureMxlFromGraphic, partIdFromGraphic } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1200px;height:3000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

const xml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name/></score-part>
    <score-part id="P5__PL"><part-name/></score-part>
  </part-list>
  <part id="P1">
    <measure number="26">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="27">
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
  <part id="P5__PL">
    <measure number="26">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><voice>5</voice><pitch><step>A</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><voice>5</voice><pitch><step>F</step><octave>3</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><voice>5</voice><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><type>quarter</type></note>
    </measure>
    <measure number="27">
      <note><voice>5</voice><pitch><step>G</step><octave>2</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

function pitchKey(gm: Record<string, unknown>): string | null {
  for (const entry of (gm.staffEntries ?? gm.StaffEntries) as unknown[] ?? []) {
    for (const gve of ((entry as Record<string, unknown>).graphicalVoiceEntries ?? (entry as Record<string, unknown>).GraphicalVoiceEntries) as unknown[] ?? []) {
      for (const note of ((gve as Record<string, unknown>).notes ?? (gve as Record<string, unknown>).Notes) as unknown[] ?? []) {
        const src = ((note as Record<string, unknown>).sourceNote ?? (note as Record<string, unknown>).SourceNote) as Record<string, unknown>;
        const p = src?.Pitch as Record<string, unknown>;
        if (p && typeof p.ToString === 'function') return (p.ToString as () => string)();
      }
    }
  }
  return null;
}

async function load(label: string, x: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(x);
  osmd.render();
  const rows: string[] = [];
  forEachOsmdSystem(osmd, (_s, rws) => {
    for (const gm of rws[1] ?? []) {
      const n = measureMxlFromGraphic(gm as Record<string, unknown>);
      if (n !== 26 && n !== 27) continue;
      rows.push(`PL m${n}=${pitchKey(gm as Record<string, unknown>)?.slice(0, 24)}`);
    }
  });
  console.log(label, rows.join(' | '));
}

void (async () => {
  const raw = repairTimelineForOsmdPreview(xml);
  await load('raw PL 12/16', raw);
  const fixed = repairUnderfullMeasuresForOsmdPreview(raw);
  if (!fixed.includes('<forward')) throw new Error('must add forward for underfull voice');
  await load('repaired', fixed);
})();
