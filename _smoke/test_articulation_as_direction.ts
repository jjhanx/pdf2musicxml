/**
 * Accent → Direction 승격 유틸 XML 회귀 (UI는 이 경로를 쓰지 않음: mf 오선 밖에 고정됨).
 * Run: npx tsx _smoke/test_articulation_as_direction.ts
 */
import { JSDOM } from 'jsdom';
import {
  applyArticulationPlacementFixesToPreviewXml,
  extraLiftedArticulationStaffSpaces,
  HITL_ART_DISTANCE_ATTR,
  HITL_LIFTED_ART_ATTR,
  liftArticulationsToDirectionsForOsmdPreview,
} from '../shared/musicXmlArticulationDistance';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup';

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
  });
}

const sample = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type><stem>up</stem><notations><articulations><accent placement="below"/></articulations></notations></note></measure></part></score-partwise>`;

function liftedDefaultY(xml: string): string | null {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return null;
  const dir = [...doc.querySelectorAll('direction')].find((d) => d.getAttribute(HITL_LIFTED_ART_ATTR) === 'accent');
  return dir?.getAttribute('default-y') ?? dir?.querySelector('words')?.getAttribute('default-y') ?? null;
}

function main() {
  setupDom();

  if (extraLiftedArticulationStaffSpaces(1) !== -3) {
    throw new Error(`1칸 pull, got ${extraLiftedArticulationStaffSpaces(1)}`);
  }

  const autoXml = liftArticulationsToDirectionsForOsmdPreview(
    prepareArticulationDefaultYForOsmdPreview(sample),
  );
  if (autoXml.includes('<accent')) throw new Error('accent must be lifted');
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
  if (liftedDefaultY(fiveXml) !== '-50') {
    throw new Error(`5칸 lift default-y expected -50, got ${liftedDefaultY(fiveXml)}`);
  }
  console.log('articulation-as-direction xml lift ok');
}

main();
