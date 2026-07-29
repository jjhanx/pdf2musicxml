/**
 * OSMD load XML must not carry note default-x (0폭·소실), but keep data-osmd-layout-x for SVG align.
 * Run: npx tsx _smoke/test_strip_default_x_keep_layout.ts
 */
import { JSDOM } from 'jsdom';
import { applyPlayOrderLayoutToMeasure } from '../shared/musicXmlPlayOrder';
import { collectPreviewNoteLayoutTargetsFromXml } from '../shared/musicXmlPlayOrder';
import { stripDefaultXyKeepLayoutAttrsForOsmdPreview } from '../shared/musicXmlTimelineCleanup';
import { OSMD_LAYOUT_X_ATTR } from '../shared/musicXmlPreviewOnsetLayout';

const dom = new JSDOM('');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
});

const xml = `<?xml version="1.0"?><score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note data-hitl-play-order="1"><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><voice>1</voice></note>
    <note data-hitl-play-order="2"><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><voice>1</voice></note>
  </measure></part>
</score-partwise>`;

const doc = new DOMParser().parseFromString(xml, 'text/xml');
const measure = doc.querySelector('measure')!;
applyPlayOrderLayoutToMeasure(measure);
const withLayout = new XMLSerializer().serializeToString(doc);
const forOsmd = stripDefaultXyKeepLayoutAttrsForOsmdPreview(withLayout);

if (/<note[^>]*\sdefault-x=/.test(forOsmd)) {
  throw new Error('OSMD XML must not retain note default-x');
}
if (!forOsmd.includes(OSMD_LAYOUT_X_ATTR)) {
  throw new Error('must keep data-osmd-layout-x for SVG align');
}
const targets = collectPreviewNoteLayoutTargetsFromXml(forOsmd);
if (targets.length < 2) throw new Error(`expected layout targets got ${targets.length}`);
if (targets[0]!.defaultXTenths === targets[1]!.defaultXTenths) {
  throw new Error('po1 and po2 must differ in layout x');
}
console.log('OK strip default-x keep layout', {
  n: targets.length,
  x0: targets[0]!.defaultXTenths,
  x1: targets[1]!.defaultXTenths,
});
