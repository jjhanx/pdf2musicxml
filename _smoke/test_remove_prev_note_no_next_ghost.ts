/**
 * 앞 음(A4)에서 accent·셈여림(ff)을 지우면 다음 음(G4) 미리보기에
 * 셈여림이 남거나 accent `>` 잔상이 생기면 안 된다. 편집기 XML과 같아야 한다.
 *
 * Run: npx tsx _smoke/test_remove_prev_note_no_next_ghost.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance.ts';
import { mergeFix, type OmrHitlFix } from '../src/omrHitlFixes.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { applyOsmdDynamicsOffsets, registerOsmdPreviewXmlForDynamics } from '../src/osmdDynamicsOffsetFix.ts';
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

function visibleDynTexts(host: HTMLElement): string[] {
  return [...host.querySelectorAll('text')]
    .filter((el) => {
      if (el.getAttribute('data-hitl-dyn-hidden') === '1') return false;
      const op = (el as SVGElement).style?.opacity ?? el.getAttribute('opacity');
      if (op === '0') return false;
      const t = (el.textContent || '').replace(/\s+/g, '').toLowerCase();
      return t === 'ff' || t === 'f';
    })
    .map((el) => (el.textContent || '').trim());
}

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
      <direction placement="below">
        <direction-type><dynamics><ff/></dynamics></direction-type>
      </direction>
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

function fid(partial: Omit<OmrHitlFix, 'id'> & { id?: string }): OmrHitlFix {
  return { id: partial.id || 't', ...partial } as OmrHitlFix;
}

async function main() {
  setupDom();

  const leftoverSet = fid({
    kind: 'setArticulationPlacement',
    partId: 'P2',
    measureMxl: '69',
    noteIndex: 2,
    articulation: 'accent',
    placement: 'below',
    distance: '5',
  });
  const removeArt = fid({
    kind: 'removeArticulation',
    partId: 'P2',
    measureMxl: '69',
    noteIndex: 2,
    articulation: 'accent',
  });
  const removeDyn = fid({
    kind: 'removeNoteDirection',
    partId: 'P2',
    measureMxl: '69',
    noteIndex: 2,
    directionType: 'dynamics',
    directionValue: 'ff',
  });

  const merged = mergeFix(mergeFix([leftoverSet], removeArt), removeDyn);
  if (merged.some((f) => f.kind === 'setArticulationPlacement')) {
    throw new Error('removeArticulation must drop leftover setArticulationPlacement');
  }
  if (!merged.some((f) => f.kind === 'removeArticulation')) {
    throw new Error('removeArticulation for original XML accent must stay in the queue');
  }
  if (!merged.some((f) => f.kind === 'removeNoteDirection')) {
    throw new Error('removeNoteDirection must stay so preview XML can strip the preceding ff');
  }

  const stripped = applyArticulationPlacementFixesToPreviewXml(xml, [
    leftoverSet,
    removeArt,
    removeDyn,
  ]);
  if (/<accent[\s>]/i.test(stripped)) {
    throw new Error('preview XML still has <accent> after remove');
  }
  if (/<ff\s*\/>/i.test(stripped) || /<ff>/.test(stripped)) {
    throw new Error('preview XML still has ff after removeNoteDirection');
  }

  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '400px';
  document.body.appendChild(host);

  const loadXml = prepareArticulationDefaultYForOsmdPreview(repairTimelineForOsmdPreview(stripped));
  const osmd = new OSMD(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    useXMLMeasureNumbers: true,
  });
  registerOsmdPreviewXmlForArticulation(osmd, loadXml);
  registerOsmdPreviewXmlForDynamics(osmd, loadXml);
  await osmd.load(loadXml);
  osmd.render();
  applyOsmdArticulationOffsetsDetailed(host, osmd);
  applyOsmdDynamicsOffsets(host, osmd, loadXml, [leftoverSet, removeArt, removeDyn]);

  const staves = [...host.querySelectorAll('.vf-stavenote')];
  if (staves.length < 4) throw new Error(`expected ≥4 stavenotes, got ${staves.length}`);
  const a4 = staves[2]!;
  const g4 = staves[3]!;
  const a4x = noteHeadX(a4);
  const g4x = noteHeadX(g4);
  if (a4x == null || g4x == null) throw new Error(`missing noteheads a4=${a4x} g4=${g4x}`);

  const g4Accents = visibleAccentXs(g4);
  if (g4Accents.length) {
    throw new Error(`ghost accent on G4 after removing A4 accent at x=${g4Accents.join(',')}`);
  }
  const a4Accents = visibleAccentXs(a4);
  if (a4Accents.length) {
    throw new Error(`accent still visible on A4 after remove at x=${a4Accents.join(',')}`);
  }

  const overlays = [...host.querySelectorAll('[data-hitl-art-overlay="accent"], [data-hitl-art-tag="accent"]')].filter(
    (el) => {
      if (el.getAttribute('data-hitl-art-hidden') === '1') return false;
      const op = (el as SVGElement).style?.opacity ?? el.getAttribute('opacity');
      if (op === '0') return false;
      return true;
    },
  );
  if (overlays.length) {
    throw new Error(`accent overlay remains after remove (${overlays.length})`);
  }

  const dyn = visibleDynTexts(host);
  if (dyn.length) {
    throw new Error(`dynamics remnant after remove: ${dyn.join(',')}`);
  }

  console.log('remove prev-note no next-ghost OK', { a4x, g4x });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
