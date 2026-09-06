/**
 * UI-path e2e: pending fixes only (no XML distance), like HITL dropdown.
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
  // UI: hint xml has NO distance attrs; distance only via pending fixes
  registerOsmdPreviewXmlForArticulation(osmd, sample);
  registerOsmdArticulationFixes(osmd, []);
  await osmd.load(xml);
  osmd.render();
  applyOsmdArticulationOffsets(host, osmd);

  const before = [...host.querySelectorAll('.vf-modifiers path')].map((p) => ({
    d: (p.getAttribute('d') || '').slice(0, 40),
    tf: p.getAttribute('transform'),
    shift: p.getAttribute('data-art-shift-y'),
  }));
  console.log('before', JSON.stringify(before, null, 2));

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

  // UI distance dropdown path
  const n = applyPendingArticulationOffsetsOnly(host, osmd, fixes);
  const after = [...host.querySelectorAll('[data-art-shift-y]')].map((el) => ({
    shift: el.getAttribute('data-art-shift-y'),
    d: (el.getAttribute('d') || '').slice(0, 40),
    tf: (el.getAttribute('transform') || '').slice(0, 50),
    tag: el.tagName,
  }));
  console.log('after pending', n, JSON.stringify(after, null, 2));

  const uniq = [...new Set(after.map((a) => a.shift).filter(Boolean))];
  if (!uniq.includes('10') || !uniq.includes('50')) {
    // also try measureMxl mismatch 0/1 like OSMD
    const fixes2 = fixes.map((f) => ({ ...f, measureMxl: '1' }));
    applyPendingArticulationOffsetsOnly(host, osmd, fixes2);
    const after2 = [...host.querySelectorAll('[data-art-shift-y]')].map((el) => el.getAttribute('data-art-shift-y'));
    console.log('retry measure 1', after2);

    // try without pitch
    const fixes3 = fixes.map(({ pitchStep, pitchOctave, ...f }) => f);
    applyPendingArticulationOffsetsOnly(host, osmd, fixes3 as any);
    const after3 = [...host.querySelectorAll('[data-art-shift-y]')].map((el) => el.getAttribute('data-art-shift-y'));
    console.log('retry no pitch', after3);

    throw new Error(`UI path failed uniq=${JSON.stringify(uniq)}`);
  }
  console.log('UI path dual art ok', uniq);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
