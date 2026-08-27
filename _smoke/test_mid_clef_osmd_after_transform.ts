/**
 * Mid-measure G must keep OSMD vfClefBefore after HITL single-staff attribute normalize.
 * Mid attrs must NOT get injected <staves> (wrong xmlns broke OSMD / hid in-staff clef).
 *
 * Run: npx tsx _smoke/test_mid_clef_osmd_after_transform.ts
 */
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import {
  normalizeMultiVoiceLayersForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  repairTimelineForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd';

const require = createRequire(import.meta.url);
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h" style="width:1000px;height:500px"></div></body></html>', {
  pretendToBeVisual: true,
});
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  SVGElement: dom.window.SVGElement,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

function local(el: Element): string {
  return (el.localName || el.tagName).toLowerCase().replace(/^.*:/, '');
}

function normalizeAllAttributesLikeHitl(measure: Element, staffN: number): void {
  let seenNote = false;
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'note') {
      seenNote = true;
      continue;
    }
    if (tag !== 'attributes') continue;
    const injectStaves = !seenNote;
    if (injectStaves) {
      let stavesEl = [...child.children].find((c) => local(c) === 'staves');
      if (!stavesEl) {
        const doc = child.ownerDocument!;
        const ns = child.namespaceURI;
        stavesEl = ns ? doc.createElementNS(ns, 'staves') : doc.createElement('staves');
        child.insertBefore(stavesEl, child.firstChild);
      }
      stavesEl.textContent = '1';
    }
    for (const clef of [...child.children].filter((c) => local(c) === 'clef')) {
      const numAttr = clef.getAttribute('number');
      if (numAttr && Number.isFinite(parseInt(numAttr, 10)) && parseInt(numAttr, 10) !== staffN) {
        clef.remove();
      } else if (clef.getAttribute('number')) {
        clef.setAttribute('number', '1');
      }
    }
  }
}

function transformLikeHitl(xml: string): string {
  let out = repairTimelineForOsmdPreview(xml);
  out = repairUnderfullMeasuresForOsmdPreview(out);
  const doc = new DOMParser().parseFromString(out, 'text/xml');
  const measure = doc.querySelector('measure')!;
  normalizeAllAttributesLikeHitl(measure, 1);
  pruneCrossStaffTimelineForOsmdPreview(measure, 1);
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
  // mid must not have staves
  const attrs = [...measure.children].filter((c) => local(c) === 'attributes');
  if (attrs.length < 2) throw new Error('expected header + mid attributes');
  const mid = attrs[1]!;
  if ([...mid.children].some((c) => local(c) === 'staves')) {
    throw new Error('mid attributes must not contain staves');
  }
  return new XMLSerializer().serializeToString(doc);
}

function countVfClefBefore(osmd: InstanceType<typeof OpenSheetMusicDisplay>): number {
  let n = 0;
  const gmeasures = osmd.GraphicSheet.MeasureList;
  for (let i = 0; i < gmeasures.length; i++) {
    for (const gm of gmeasures[i] ?? []) {
      if (!gm) continue;
      for (const se of gm.staffEntries ?? []) {
        if (se.vfClefBefore) n += 1;
      }
    }
  }
  return n;
}

const RAW = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  const xml = '<?xml version="1.0"?>' + transformLikeHitl(RAW);
  const host = document.getElementById('h')!;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawTitle: false });
  await osmd.load(xml);
  osmd.render();
  const n = countVfClefBefore(osmd);
  console.log('vfClefBefore after HITL-like transform', n);
  if (n < 1) throw new Error('OSMD lost mid-measure clef after transform');
  console.log('mid_clef_osmd_after_transform ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
