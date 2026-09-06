/**
 * UI-path: pending distance → 표별 path 이동.
 * Run: npx tsx _smoke/test_dual_art_ui_path.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import {
  applyOsmdArticulationOffsets,
  applyPendingArticulationOffsetsOnly,
  registerOsmdArticulationFixes,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';

const OSMD =
  (osmdLib as any).OpenSheetMusicDisplay || (osmdLib as any).default?.OpenSheetMusicDisplay;

const sample = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1"><measure number="50"><attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><stem>up</stem><notations><articulations><tenuto placement="below"/><accent placement="below"/></articulations></notations></note></measure></part></score-partwise>`;

async function main() {
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
  });

  const host = document.createElement('div');
  host.style.width = '800px';
  document.body.appendChild(host);
  const xml = prepareArticulationDefaultYForOsmdPreview(sample);
  const osmd = new OSMD(host, { autoResize: false, drawTitle: false });
  registerOsmdPreviewXmlForArticulation(osmd, sample);
  registerOsmdArticulationFixes(osmd, []);
  await osmd.load(xml);
  osmd.render();
  applyOsmdArticulationOffsets(host, osmd);

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

  applyPendingArticulationOffsetsOnly(host, osmd, fixes);
  let tagged = [...host.querySelectorAll('[data-hitl-art-tag]')].map((el) => ({
    tag: el.getAttribute('data-hitl-art-tag'),
    spaces: el.getAttribute('data-art-spaces'),
    shift: el.getAttribute('data-art-shift-y'),
  }));
  console.log('tagged', tagged);
  const byTag = Object.fromEntries(tagged.map((t) => [t.tag!, t]));
  if (byTag.tenuto?.spaces === '2' && byTag.accent?.spaces === '6') {
    const s1 = Math.abs(parseFloat(byTag.tenuto.shift || '0'));
    const s2 = Math.abs(parseFloat(byTag.accent.shift || '0'));
    if (Math.abs(s1 - s2) >= 15) {
      console.log('UI path dual art ok', byTag);
      return;
    }
  }

  applyPendingArticulationOffsetsOnly(
    host,
    osmd,
    fixes.map((f) => ({ ...f, measureMxl: '1' })),
  );
  tagged = [...host.querySelectorAll('[data-hitl-art-tag]')].map((el) => ({
    tag: el.getAttribute('data-hitl-art-tag'),
    spaces: el.getAttribute('data-art-spaces'),
    shift: el.getAttribute('data-art-shift-y'),
  }));
  const byTag2 = Object.fromEntries(tagged.map((t) => [t.tag!, t]));
  if (
    byTag2.tenuto?.spaces === '2' &&
    byTag2.accent?.spaces === '6' &&
    Math.abs(parseFloat(byTag2.tenuto.shift || '0') - parseFloat(byTag2.accent.shift || '0')) >= 15
  ) {
    console.log('UI path dual art ok (m1)', byTag2);
    return;
  }
  throw new Error(`UI path failed ${JSON.stringify(tagged)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
