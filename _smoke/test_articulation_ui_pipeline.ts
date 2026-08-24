/**
 * UI와 동일한 경로: pending patch → buildOsmdPreviewXml → sanitize → OSMD shift.
 * Run: npx tsx _smoke/test_articulation_ui_pipeline.ts
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { buildOsmdPreviewXml } from '../src/AudiverisInspectPanel';
import { registerOsmdPreviewXmlForAlign } from '../src/osmdOnsetColumnAlignFix';
import {
  applyOsmdArticulationOffsetsDetailed,
  orderedHintsByMeasureFromXml,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance';
import { prepareArticulationDefaultYForOsmdPreview } from '../shared/musicXmlTimelineCleanup';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

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
      const d = this.getAttribute?.('d') ?? '';
      const m = /M\s*([-\d.eE+]+)\s+([-\d.eE+]+)/.exec(d);
      return {
        x: m ? parseFloat(m[1]!) : 0,
        y: m ? parseFloat(m[2]!) : 0,
        width: 12,
        height: 12,
      } as DOMRect;
    };
  }
  return dom;
}

function findAccentNoteIndex(xml: string, measureNumber: string): number {
  const doc = parseMusicXmlDocument(xml)!;
  const part = [...doc.documentElement.children].find((c) => c.getAttribute('id') === 'P5');
  const measure = [...(part?.children ?? [])].find(
    (c) => c.localName === 'measure' && c.getAttribute('number') === measureNumber,
  )!;
  const notes = [...measure.children].filter((c) => c.localName === 'note');
  return notes.findIndex((n) =>
    [...n.querySelectorAll('*')].some((el) => el.localName === 'accent'),
  );
}

function accentAttrsInXml(xml: string): string[] {
  return [...xml.matchAll(/<accent\b[^>]*\/?>/g)].map((m) => m[0]);
}

async function runPipeline(label: string, distance: string | null) {
  setupDom();
  const raw = fs.readFileSync('_smoke/_diag_full_auto.xml', 'utf8');
  const noteIdx = findAccentNoteIndex(raw, '19');
  let xml = raw;
  if (distance) {
    xml = applyArticulationPlacementFixesToPreviewXml(xml, [
      {
        kind: 'setArticulationPlacement',
        partId: 'P5',
        measureMxl: '19',
        noteIndex: noteIdx,
        articulation: 'accent',
        placement: 'below',
        distance,
      },
    ]);
  }
  const parts = [
    { id: 'P1', index: 0, suggestedLabel: 'S' },
    { id: 'P2', index: 1, suggestedLabel: 'A' },
    { id: 'P3', index: 2, suggestedLabel: 'T' },
    { id: 'P4', index: 3, suggestedLabel: 'B' },
    { id: 'P5', index: 4, suggestedLabel: 'P' },
  ];
  // UI: staff filter P5 only (common when editing piano)
  const filtered = buildOsmdPreviewXml(xml, parts, { label: 'P', partId: 'P5' }, { verbatim: true });
  const accents = accentAttrsInXml(filtered);
  const hints = orderedHintsByMeasureFromXml(filtered);
  const hintList = [...hints.entries()].map(([k, v]) => ({
    k,
    spaces: v.map((h) => h.hint.staffSpaces),
    dist: v.map((h) => h.hint.distance),
  }));

  const host = document.createElement('div');
  host.style.width = '1100px';
  host.style.height = '800px';
  document.body.appendChild(host);
  const osmd = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
  registerOsmdPreviewXmlForArticulation(osmd, filtered);
  registerOsmdPreviewXmlForAlign(osmd, filtered);
  await osmd.load(prepareArticulationDefaultYForOsmdPreview(filtered));
  await osmd.render();

  const stats = applyOsmdArticulationOffsetsDetailed(host, osmd);
  const shiftedMods = [...host.querySelectorAll('[data-art-shift-y]')].map((el) => ({
    shiftY: el.getAttribute('data-art-shift-y'),
    transform: el.getAttribute('transform'),
    className: el.getAttribute('class'),
    pathY: el.querySelector('path')?.getAttribute('d')?.match(/M\s*[-\d.]+\s+([-\d.]+)/)?.[1],
  }));

  console.log(`\n=== ${label} ===`);
  console.log({ noteIdx, accents, hintList, stats, shiftedMods: shiftedMods.slice(0, 5), modTotal: shiftedMods.length });
  host.remove();
  return { stats, shiftedMods, accents, hintList };
}

async function main() {
  if (!fs.existsSync('_smoke/_diag_full_auto.xml')) {
    // fallback: p5-only file treated as full
    fs.copyFileSync('_smoke/_diag_p5_auto.xml', '_smoke/_diag_full_auto.xml.bak_use_p5');
  }
  const src = fs.existsSync('_smoke/_diag_full_auto.xml')
    ? '_smoke/_diag_full_auto.xml'
    : '_smoke/_diag_p5_auto.xml';
  if (src !== '_smoke/_diag_full_auto.xml') {
    console.log('using', src);
  }
  // monkey: rewrite raw path inside run by writing temp if needed
  const auto = await runPipeline('auto', null);
  const five = await runPipeline('5칸', '5');

  const autoY = Math.max(0, ...auto.shiftedMods.map((m) => parseFloat(m.shiftY ?? '0')));
  const fiveY = Math.max(0, ...five.shiftedMods.map((m) => parseFloat(m.shiftY ?? '0')));
  console.log('\nCOMPARE', { autoY, fiveY, autoShifted: auto.stats.shifted, fiveShifted: five.stats.shifted });

  if (five.stats.shifted === 0) throw new Error('5칸 shifted=0');
  if (fiveY <= autoY) throw new Error(`5칸 shiftY ${fiveY} <= auto ${autoY}`);
  if (!five.accents.some((a) => a.includes('data-hitl-art-distance="5"'))) {
    throw new Error(`accent attr missing after buildOsmdPreviewXml: ${five.accents.join(' | ')}`);
  }
  console.log('ui pipeline ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
