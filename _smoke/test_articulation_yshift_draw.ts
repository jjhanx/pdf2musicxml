/**
 * Accent 거리 — VexFlow Articulation.draw는 between_lines 스냅으로 y_shift를 무력화함.
 * 실제 Accent는 .vf-modifiers 래퍼 g[data-hitl-art-wrap] transform으로 옮긴다.
 * Run: npx tsx _smoke/test_articulation_yshift_draw.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import {
  applyOsmdArticulationOffsets,
  applyPendingArticulationOffsetsOnly,
  extraYPxFromArticulationFixes,
  registerOsmdArticulationFixes,
  registerOsmdPreviewXmlForArticulation,
  setHitlArticulationExtraYPx,
} from '../src/osmdArticulationOffsetFix';
import { registerOsmdPreviewXmlForAlign } from '../src/osmdOnsetColumnAlignFix';
import { patchOsmdRenderForMeasureNumbers } from '../src/osmdMeasureNumberSuppress';

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
    queueMicrotask: (cb: () => void) => Promise.resolve().then(cb),
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 0;
    },
  });
  const proto = dom.window.SVGGraphicsElement.prototype as SVGGraphicsElement;
  if (!proto.getBBox) {
    proto.getBBox = function () {
      return { x: 0, y: 0, width: 10, height: 10 } as DOMRect;
    };
  }
  return dom;
}

function wrapTransform(host: HTMLElement): string | null {
  return host.querySelector('.vf-modifiers > g[data-hitl-art-wrap]')?.getAttribute('transform') ?? null;
}

async function main() {
  setupDom();
  const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name/></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type><stem>up</stem><notations><articulations><accent placement="below"/></articulations></notations></note></measure></part></score-partwise>`;

  const host = document.createElement('div');
  host.className = 'omr-osmd-clickable';
  host.style.width = '800px';
  host.style.height = '400px';
  document.body.appendChild(host);

  const osmd = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
  patchOsmdRenderForMeasureNumbers(osmd, host, () => undefined);
  registerOsmdPreviewXmlForAlign(osmd, xml);
  registerOsmdPreviewXmlForArticulation(osmd, xml);
  await osmd.load(xml);
  osmd.zoom = 1;
  osmd.render();

  const fixes = [
    {
      kind: 'setArticulationPlacement' as const,
      partId: 'P1',
      measureMxl: 1,
      noteIndex: 0,
      articulation: 'accent',
      placement: 'below' as const,
      distance: '5',
    },
  ];
  const extra = extraYPxFromArticulationFixes(fixes, 10);
  assert.equal(extra, 40);
  for (const g of host.querySelectorAll('.vf-modifiers')) {
    g.setAttribute('transform', 'translate(10, 20)');
  }
  const softN = applyPendingArticulationOffsetsOnly(host, osmd, fixes);
  assert.ok(softN >= 1, `expected soft shift, got ${softN}`);
  assert.equal(host.getAttribute('data-hitl-art-dy'), '40');
  assert.equal(wrapTransform(host), 'translate(0, 40)');

  osmd.render();
  applyOsmdArticulationOffsets(host, osmd);
  assert.equal(host.getAttribute('data-hitl-art-dy'), '40');
  assert.equal(wrapTransform(host), 'translate(0, 40)', 're-applied after render');

  applyPendingArticulationOffsetsOnly(host, osmd, []);
  assert.equal(host.getAttribute('data-hitl-art-dy'), '0');
  assert.equal(wrapTransform(host), null);

  setHitlArticulationExtraYPx(0);
  registerOsmdArticulationFixes(osmd, []);
  console.log('articulation wrap transform dy ok', { extra });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
