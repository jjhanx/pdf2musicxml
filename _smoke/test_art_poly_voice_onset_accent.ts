/**
 * backup 뒤 2성부가 마디 앞에 겹치면 OSMD 박자순 ≠ XML 문서순.
 * PR m69 #18 B4에 accent를 넣으면 앞 음(A4)에 그리던 회귀 방지.
 *
 * Run: npx tsx _smoke/test_art_poly_voice_onset_accent.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance.ts';
import { prepareArticulationDefaultYForOsmdPreview, repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  graphicNotePitchLabel,
  registerOsmdArticulationFixes,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { forEachGraphicalMeasure } from '../src/osmdMeasureClick.ts';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;
if (!OSMD) throw new Error('OSMD missing');

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 0;
    },
  });
  const proto = dom.window.SVGGraphicsElement.prototype as SVGGraphicsElement;
  if (!proto.getBBox) {
    proto.getBBox = function () {
      return { x: 0, y: 0, width: 12, height: 12 } as DOMRect;
    };
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function pathStartX(el: Element): number | null {
  const d = el.getAttribute('d') ?? '';
  const m = /M\s*([-\d.eE+]+)/.exec(d);
  if (m) return parseFloat(m[1]!);
  const x = parseFloat(el.getAttribute('x') || '');
  return Number.isFinite(x) ? x : null;
}

function noteHeadX(stave: Element | null): number | null {
  if (!stave) return null;
  const nh = stave.querySelector('.vf-notehead path, .vf-note path');
  return nh ? pathStartX(nh) : null;
}

/** rest + A4/A5 8분 + B4/B5 8분(accent) + backup + 마디 앞 C#5/E5 4분 */
const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>PR</part-name></score-part></part-list>
  <part id="P5">
    <measure number="69">
      <attributes>
        <divisions>24</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><rest/><duration>12</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>12</duration><voice>1</voice><type>eighth</type><stem>up</stem><staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>A</step><octave>5</octave></pitch>
        <duration>12</duration><voice>1</voice><type>eighth</type><stem>up</stem><staff>1</staff>
      </note>
      <note>
        <pitch><step>B</step><octave>4</octave></pitch>
        <duration>12</duration><voice>1</voice><type>eighth</type><stem>up</stem><staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>B</step><octave>5</octave></pitch>
        <duration>12</duration><voice>1</voice><type>eighth</type><stem>up</stem><staff>1</staff>
      </note>
      <backup><duration>36</duration></backup>
      <note>
        <pitch><step>C</step><alter>1</alter><octave>5</octave></pitch>
        <duration>24</duration><voice>2</voice><type>quarter</type><stem>up</stem><staff>1</staff>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>5</octave></pitch>
        <duration>24</duration><voice>2</voice><type>quarter</type><stem>up</stem><staff>1</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  setupDom();
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '400px';
  document.body.appendChild(host);

  const fixes = [
    {
      kind: 'addArticulation' as const,
      partId: 'P5',
      measureMxl: '69',
      noteIndex: 3,
      articulation: 'accent',
      placement: 'below' as const,
      distance: '3',
      pitchStep: 'B',
      pitchOctave: 4,
      staffWithinPart: 1,
    },
  ];

  let loadXml = repairTimelineForOsmdPreview(xml);
  loadXml = applyArticulationPlacementFixesToPreviewXml(loadXml, fixes);
  loadXml = prepareArticulationDefaultYForOsmdPreview(loadXml);

  const osmd = new OSMD(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    useXMLMeasureNumbers: true,
  });
  registerOsmdPreviewXmlForArticulation(osmd, loadXml);
  registerOsmdArticulationFixes(osmd, fixes);
  await osmd.load(loadXml);
  osmd.render();
  applyOsmdArticulationOffsetsDetailed(host, osmd);

  const rows: Array<{ pitches: string[]; x: number | null }> = [];
  forEachGraphicalMeasure(osmd, (gm) => {
    const staffEntries = ((gm as { staffEntries?: unknown[] }).staffEntries ?? []) as unknown[];
    for (const seRaw of staffEntries) {
      const se = asRecord(seRaw);
      if (!se) continue;
      const gves = (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[];
      for (const gveRaw of gves) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        const gNotes = (gve.notes ?? gve.Notes ?? []) as Array<Record<string, unknown>>;
        if (!gNotes.length) continue;
        const pitches = gNotes.map((gn) => graphicNotePitchLabel(gn)).filter(Boolean) as string[];
        if (!pitches.length) continue;
        const vf = asRecord(gve.mVexFlowStaveNote ?? gve.vfStaveNote ?? gve.staveNote);
        const el =
          (asRecord(asRecord(vf)?.attrs)?.el as Element | undefined) ??
          (typeof vf?.getAttribute === 'function' ? (vf.getAttribute('el') as Element | null) : null);
        const stave = el?.closest?.('.vf-stavenote, .vf-staveNote') ?? el ?? null;
        rows.push({ pitches, x: noteHeadX(stave) });
      }
    }
  });

  const a4 = rows.find((r) => r.pitches.includes('A4') && r.pitches.includes('A5'));
  const b4 = rows.find((r) => r.pitches.includes('B4') && r.pitches.includes('B5'));
  if (!a4 || !b4 || a4.x == null || b4.x == null) {
    throw new Error(`missing chords a4=${JSON.stringify(a4)} b4=${JSON.stringify(b4)} rows=${JSON.stringify(rows)}`);
  }
  const accents = [...host.querySelectorAll('[data-hitl-art-tag="accent"], [data-hitl-art-overlay="accent"]')].map((el) => {
    if (el.getAttribute('data-hitl-art-hidden') === '1') return null;
    const op = (el as SVGElement).style?.opacity ?? el.getAttribute('opacity');
    if (op === '0') return null;
    return pathStartX(el);
  }).filter((x): x is number => x != null);
  if (!accents.length) {
    throw new Error(`no accent overlay debug=${host.getAttribute('data-hitl-art-debug')} rows=${JSON.stringify(rows)}`);
  }
  for (const ax of accents) {
    if (Math.abs(ax - a4.x) < Math.abs(ax - b4.x)) {
      throw new Error(`accent x=${ax} closer to previous A4 (${a4.x}) than B4 (${b4.x}) debug=${host.getAttribute('data-hitl-art-debug')}`);
    }
  }
  console.log('poly voice onset accent OK', { a4, b4, accents, debug: host.getAttribute('data-hitl-art-debug') });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
