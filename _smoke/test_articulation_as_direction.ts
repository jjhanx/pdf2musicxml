/**
 * Accent → OSMD Direction(words) 미리보기 — VexFlow Articulation 경로를 타지 않음.
 * Run: npx tsx _smoke/test_articulation_as_direction.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import {
  applyArticulationPlacementFixesToPreviewXml,
  HITL_ART_DISTANCE_ATTR,
  HITL_LIFTED_ART_ATTR,
  liftArticulationsToDirectionsForOsmdPreview,
} from '../shared/musicXmlArticulationDistance';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix';

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
      return { x: 0, y: 0, width: 10, height: 10 } as DOMRect;
    };
  }
  return dom;
}

const sample = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type><stem>up</stem><notations><articulations><accent placement="below"/></articulations></notations></note></measure></part></score-partwise>`;

function liftedDefaultY(xml: string): string | null {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return null;
  const dir = [...doc.querySelectorAll('direction')].find((d) => d.getAttribute(HITL_LIFTED_ART_ATTR) === 'accent');
  return dir?.getAttribute('default-y') ?? dir?.querySelector('words')?.getAttribute('default-y') ?? null;
}

function assertNoAccentArticulation(xml: string) {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse');
  if (doc.querySelector('accent')) throw new Error('accent articulation must be lifted off the note');
  if (!doc.querySelector('words')) throw new Error('lifted accent must be OSMD words (direction)');
}

async function appliedShiftY(xml: string): Promise<{ shiftY: number; texts: string[] }> {
  const dom = setupDom();
  const host = dom.window.document.createElement('div');
  host.style.width = '700px';
  host.style.height = '300px';
  dom.window.document.body.appendChild(host);
  const osmd = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
  registerOsmdPreviewXmlForArticulation(osmd, xml);
  await osmd.load(xml);
  await osmd.render();
  applyOsmdArticulationOffsetsDetailed(host, osmd);
  const texts = [...host.querySelectorAll('text')].map((t) => (t.textContent ?? '').trim());
  const shiftYs = [...host.querySelectorAll('[data-art-shift-y]')].map((el) =>
    parseFloat(el.getAttribute('data-art-shift-y') ?? '0'),
  );
  const shiftY = shiftYs.length ? Math.max(...shiftYs.map((n) => Math.abs(n))) : 0;
  host.remove();
  return { shiftY, texts };
}

async function main() {
  setupDom();

  const autoXml = liftArticulationsToDirectionsForOsmdPreview(
    prepareArticulationDefaultYForOsmdPreview(sample),
  );
  assertNoAccentArticulation(autoXml);
  if (liftedDefaultY(autoXml) !== '-10') {
    throw new Error(`auto lift default-y expected -10, got ${liftedDefaultY(autoXml)}`);
  }

  const patched = applyArticulationPlacementFixesToPreviewXml(sample, [
    {
      kind: 'setArticulationPlacement',
      partId: 'P1',
      measureMxl: '1',
      noteIndex: 0,
      articulation: 'accent',
      placement: 'below',
      distance: '5',
      pitchStep: 'F',
      pitchOctave: 4,
      pitchAlter: 1,
    },
  ]);
  if (!patched.includes(`${HITL_ART_DISTANCE_ATTR}="5"`)) {
    throw new Error('distance=5 not applied to accent before lift');
  }
  const fiveXml = liftArticulationsToDirectionsForOsmdPreview(
    prepareArticulationDefaultYForOsmdPreview(patched),
  );
  assertNoAccentArticulation(fiveXml);
  if (liftedDefaultY(fiveXml) !== '-50') {
    throw new Error(`5칸 lift default-y expected -50, got ${liftedDefaultY(fiveXml)}`);
  }

  const auto = await appliedShiftY(autoXml);
  const five = await appliedShiftY(fiveXml);
  console.log('direction accent', { auto, five, dyAuto: liftedDefaultY(autoXml), dyFive: liftedDefaultY(fiveXml) });
  if (!auto.texts.some((t) => t.includes('>'))) {
    throw new Error(`OSMD did not draw lifted accent words: ${auto.texts.join(',')}`);
  }
  if (five.shiftY <= auto.shiftY) {
    throw new Error(`5칸 shift(${five.shiftY}) should exceed auto(${auto.shiftY})`);
  }
  console.log('articulation-as-direction ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
