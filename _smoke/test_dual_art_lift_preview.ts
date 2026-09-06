/**
 * Lift stacking XML only (OSMD merges words into one text — do not use lift for UI).
 * Run: npx tsx _smoke/test_dual_art_lift_preview.ts
 */
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import {
  applyArticulationPlacementFixesToPreviewXml,
  HITL_LIFTED_ART_ATTR,
  liftArticulationsToDirectionsForOsmdPreview,
} from '../shared/musicXmlArticulationDistance.ts';
import { parseMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const sample = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1"><measure number="50"><attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><stem>up</stem><notations><articulations><tenuto placement="below"/><accent placement="below"/></articulations></notations></note></measure></part></score-partwise>`;

const fixes = [
  {
    kind: 'setArticulationPlacement' as const,
    partId: 'P1',
    measureMxl: '50',
    noteIndex: 0,
    articulation: 'tenuto',
    placement: 'below' as const,
    distance: '2',
    pitchStep: 'B',
    pitchOctave: 4,
  },
  {
    kind: 'setArticulationPlacement' as const,
    partId: 'P1',
    measureMxl: '50',
    noteIndex: 0,
    articulation: 'accent',
    placement: 'below' as const,
    distance: '6',
    pitchStep: 'B',
    pitchOctave: 4,
  },
];

let xml = applyArticulationPlacementFixesToPreviewXml(sample, fixes);
xml = prepareArticulationDefaultYForOsmdPreview(xml);
xml = liftArticulationsToDirectionsForOsmdPreview(xml);
const dirs = [...parseMusicXmlDocument(xml)!.querySelectorAll('direction')].filter((d) =>
  d.getAttribute(HITL_LIFTED_ART_ATTR),
);
const dys = dirs.map((d) => d.getAttribute('default-y'));
if (dirs.length !== 2) throw new Error(`dirs ${dirs.length}`);
if (new Set(dys).size < 2) throw new Error(`dy ${dys}`);

const auto = liftArticulationsToDirectionsForOsmdPreview(
  prepareArticulationDefaultYForOsmdPreview(sample),
);
const autoDy = [...parseMusicXmlDocument(auto)!.querySelectorAll('direction')]
  .filter((d) => d.getAttribute(HITL_LIFTED_ART_ATTR))
  .map((d) => d.getAttribute('default-y'));
if (new Set(autoDy).size < 2) throw new Error(`auto dy ${autoDy}`);

console.log('dual art lift xml stack ok', { dys, autoDy });
