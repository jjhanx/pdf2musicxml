/**
 * 앞 음에만 accent가 있고 마디 끝에 삽입한 음에는 없을 때
 * OSMD 미리보기가 뒤 음에 유령 `>` 를 그리지 않는지.
 *
 * Repro: SATB A m69 — A4 quarter+accent, 삽입 G4 eighth (XML에 accent 없음).
 * Run: npx tsx _smoke/test_insert_last_note_ghost_accent.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { prepareArticulationDefaultYForOsmdPreview, repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

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

function pathStart(d: string): { x: number; y: number } | null {
  const m = /M\s*([-\d.eE+]+)\s+([-\d.eE+]+)/.exec(d);
  if (!m) return null;
  return { x: parseFloat(m[1]!), y: parseFloat(m[2]!) };
}

function visibleAccentXs(stave: Element): number[] {
  const xs: number[] = [];
  for (const p of stave.querySelectorAll('.vf-modifiers path')) {
    if (p.getAttribute('data-hitl-art-hidden') === '1') continue;
    const op = (p as SVGElement).style?.opacity ?? p.getAttribute('opacity');
    if (op === '0') continue;
    const xy = pathStart(p.getAttribute('d') ?? '');
    if (xy) xs.push(xy.x);
  }
  return xs;
}

function noteHeadX(stave: Element): number | null {
  const nh = stave.querySelector('.vf-notehead path, .vf-note path');
  if (!nh) return null;
  return pathStart(nh.getAttribute('d') ?? '')?.x ?? null;
}

/** P2 m69 구조: 2분 E4 → 8분쉼 → 4분 A4+accent(거리5) → 삽입 8분 G4 (표 없음) */
const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P2"><part-name>A</part-name></score-part></part-list>
  <part id="P2">
    <measure number="69">
      <attributes>
        <divisions>24</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>48</duration><voice>1</voice><type>half</type><stem>up</stem>
      </note>
      <note>
        <rest/><duration>12</duration><voice>1</voice><type>eighth</type>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>24</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations>
          <articulations>
            <accent placement="below" default-y="-50" data-hitl-art-distance="5"/>
          </articulations>
        </notations>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>12</duration><voice>1</voice><type>eighth</type><stem>up</stem>
        <staff>1</staff>
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

  const loadXml = prepareArticulationDefaultYForOsmdPreview(repairTimelineForOsmdPreview(xml));
  const osmd = new OSMD(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    useXMLMeasureNumbers: true,
  });
  registerOsmdPreviewXmlForArticulation(osmd, loadXml);
  await osmd.load(loadXml);
  osmd.render();
  applyOsmdArticulationOffsetsDetailed(host, osmd);

  const staves = [...host.querySelectorAll('.vf-stavenote')];
  if (staves.length < 4) throw new Error(`expected ≥4 stavenotes, got ${staves.length}`);

  const a4 = staves[2]!;
  const g4 = staves[3]!;
  const a4x = noteHeadX(a4);
  const g4x = noteHeadX(g4);
  if (a4x == null || g4x == null) throw new Error(`missing noteheads a4=${a4x} g4=${g4x}`);

  const g4Accents = visibleAccentXs(g4);
  if (g4Accents.length) {
    throw new Error(`ghost accent on inserted G4 at x=${g4Accents.join(',')}`);
  }

  const overlaysOnG4 = [...host.querySelectorAll('[data-hitl-art-overlay="accent"], [data-hitl-art-tag="accent"]')].filter(
    (el) => {
      const x = parseFloat(el.getAttribute('x') || '');
      if (!Number.isFinite(x)) {
        const xy = pathStart(el.getAttribute('d') ?? '');
        if (!xy) return false;
        return Math.abs(xy.x - g4x) < Math.abs(xy.x - a4x);
      }
      return Math.abs(x - g4x) < Math.abs(x - a4x);
    },
  );
  if (overlaysOnG4.length) {
    throw new Error(`accent overlay closer to inserted G4 than to A4`);
  }

  console.log('insert last-note ghost accent OK', { a4x, g4x, debug: host.getAttribute('data-hitl-art-debug') });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
