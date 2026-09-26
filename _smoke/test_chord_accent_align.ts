/**
 * 화음(chord)에 부착된 accent 등의 아티큘레이션 표가
 * 음표머리 중심(cx)과 일치하여 좌우로 벗어나지 않는지 검증.
 *
 * Repro: omr-work-48d39f0a m44 PR 마지막 화음 (G5+G6) + accent above.
 * Run: npx tsx _smoke/test_chord_accent_align.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { resolveNoteHeadX } from '../src/osmdArticulationOverlay.ts';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

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

function parsePathBounds(d: string): { minX: number; maxX: number; cx: number } | null {
  const nums = d.match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const xs: number[] = [];
  for (let i = 0; i < nums.length - 1; i += 2) {
    xs.push(parseFloat(nums[i]!));
  }
  if (!xs.length) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return { minX, maxX, cx: (minX + maxX) / 2 };
}

function parseTranslateX(tr: string): number {
  const m = /translate\(\s*([-\d.eE+]+)/.exec(tr);
  return m ? parseFloat(m[1]!) : 0;
}

const chordXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>Piano</part-name></score-part></part-list>
  <part id="P5">
    <measure number="44">
      <attributes>
        <divisions>12</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>G</step><octave>5</octave></pitch>
        <duration>12</duration>
        <voice>1</voice>
        <type>quarter</type>
        <stem>down</stem>
        <notations>
          <articulations>
            <accent placement="above" default-y="50" data-hitl-art-distance="5"/>
          </articulations>
        </notations>
      </note>
      <note>
        <chord/>
        <pitch><step>G</step><octave>6</octave></pitch>
        <duration>12</duration>
        <voice>1</voice>
        <type>quarter</type>
        <stem>down</stem>
      </note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  setupDom();
  const host = document.createElement('div');
  host.style.width = '800px';
  document.body.appendChild(host);

  const loadXml = prepareArticulationDefaultYForOsmdPreview(chordXml);
  const osmd = new OSMD(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
  });
  registerOsmdPreviewXmlForArticulation(osmd, loadXml);

  await osmd.load(loadXml);
  osmd.render();

  // Test with an onset column alignment translation on the stavenote
  const sn = host.querySelector('.vf-stavenote') as SVGGraphicsElement;
  if (!sn) throw new Error('vf-stavenote not found');

  const simulatedTx = -12.5;
  sn.setAttribute('transform', `translate(${simulatedTx}, 0)`);

  // Apply articulation offsets
  applyOsmdArticulationOffsetsDetailed(host, osmd);

  // Check notehead and accent alignment
  const nhPaths = sn.querySelectorAll('.vf-notehead path');
  if (nhPaths.length < 2) throw new Error(`expected 2 noteheads in chord, got ${nhPaths.length}`);

  const nh0Bounds = parsePathBounds(nhPaths[0]!.getAttribute('d') || '');
  const nh1Bounds = parsePathBounds(nhPaths[1]!.getAttribute('d') || '');
  if (!nh0Bounds || !nh1Bounds) throw new Error('failed to parse notehead bounds');

  const modPath = sn.querySelector('.vf-modifiers path');
  if (!modPath) throw new Error('accent path not found');
  const modBounds = parsePathBounds(modPath.getAttribute('d') || '');
  if (!modBounds) throw new Error('failed to parse accent bounds');

  const diffX = Math.abs(nh0Bounds.cx - modBounds.cx);
  console.log(`Chord Notehead cx=${nh0Bounds.cx.toFixed(2)}, Accent cx=${modBounds.cx.toFixed(2)}, diff=${diffX.toFixed(3)}px`);

  if (diffX > 0.5) {
    throw new Error(`accent is displaced horizontally from notehead center by ${diffX.toFixed(2)}px (> 0.5px)`);
  }

  // Check resolveNoteHeadX returns the screen center including ancestor translate
  const screenCx = resolveNoteHeadX(sn, [modPath]);
  const expectedScreenCx = nh0Bounds.cx + simulatedTx;
  console.log(`resolveNoteHeadX=${screenCx.toFixed(2)}, expectedScreenCx=${expectedScreenCx.toFixed(2)}`);

  if (Math.abs(screenCx - expectedScreenCx) > 0.5) {
    throw new Error(`resolveNoteHeadX did not include ancestor translate or center correctly: got ${screenCx}, expected ${expectedScreenCx}`);
  }

  console.log('test_chord_accent_align OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
