/**
 * Partial voice — voice1 timeline po1 + voice2 explicit po1 SVG x 정렬.
 * Run: npx tsx _smoke/test_partial_voice_osmd_align.ts
 */
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
import { HITL_PLAY_ORDER_ATTR } from '../shared/musicXmlPlayOrder';
import { repairTimelineForOsmdPreview, stripDefaultXyKeepLayoutAttrsForOsmdPreview } from '../shared/musicXmlTimelineCleanup';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});
if (!dom.window.SVGSVGElement.prototype.createSVGPoint) {
  dom.window.SVGSVGElement.prototype.createSVGPoint = function () {
    const pt = { x: 0, y: 0 };
    return {
      ...pt,
      matrixTransform(m: DOMMatrix) {
        return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
      },
    };
  } as typeof dom.window.SVGSVGElement.prototype.createSVGPoint;
}

const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>PL</part-name></score-part></part-list>
  <part id="P5">
    <measure number="1">
      <attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>6</duration><type>eighth</type><voice>1</voice><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>6</duration><type>eighth</type><voice>1</voice><staff>2</staff></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>12</duration><type>quarter</type><voice>1</voice><staff>2</staff></note>
      <note><rest/><duration>24</duration><type>quarter</type><voice>1</voice><staff>2</staff></note>
      <backup><duration>87</duration></backup>
      <forward><duration>18</duration></forward>
      <note ${HITL_PLAY_ORDER_ATTR}="1"><pitch><step>A</step><octave>2</octave></pitch><duration>48</duration><type>half</type><voice>2</voice><staff>2</staff></note>
      <note ${HITL_PLAY_ORDER_ATTR}="2"><pitch><step>A</step><octave>2</octave></pitch><duration>24</duration><type>quarter</type><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

function noteheadX(sn: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of sn.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const pathEl = path as SVGGraphicsElement;
    const ctm = pathEl.getCTM?.() ?? sn.getCTM?.();
    if (ctm) {
      xs.push(ctm.a * parseFloat(m[1]!) + ctm.e);
      continue;
    }
    let tx = 0;
    let cur: Element | null = pathEl;
    while (cur) {
      const tr = cur.getAttribute?.('transform') ?? '';
      const tm = /translate\(\s*([-\d.]+)/.exec(tr);
      if (tm) tx += parseFloat(tm[1]!);
      cur = cur.parentElement;
    }
    xs.push(tx + parseFloat(m[1]!));
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

async function main() {
  let preview = repairTimelineForOsmdPreview(SAMPLE, { faithfulEditorLayout: true });
  preview = stripDefaultXyKeepLayoutAttrsForOsmdPreview(preview);

  const host = document.getElementById('host')!;
  host.style.width = '600px';
  host.style.height = '200px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, preview);
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();

  const stavenotes = [...host.querySelectorAll('.vf-stavenote,.vf-staveNote')] as SVGGraphicsElement[];
  if (stavenotes.length < 2) {
    throw new Error(`OSMD rendered too few stavenotes: ${stavenotes.length}, html=${host.innerHTML.length}`);
  }
  const xsBefore = stavenotes.map((sn) => noteheadX(sn)).filter((x): x is number => x != null);
  const minBefore = Math.min(...xsBefore);

  alignOsmdPreviewNotesByOnsetColumn(osmd as never, preview);
  alignOsmdPreviewNotesByOnsetColumn(osmd as never, preview);

  const xsAfter = stavenotes.map((sn) => noteheadX(sn)).filter((x): x is number => x != null);
  const minAfter = Math.min(...xsAfter);
  const po1Cluster = xsAfter.filter((x) => Math.abs(x - minAfter) < 4);
  const po2Notes = xsAfter.filter((x) => x > minAfter + 20);

  console.log('x', { minBefore, minAfter, po1Cluster: po1Cluster.length, po2Notes });
  if (po1Cluster.length < 2) {
    throw new Error(`expected >=2 notes at po1 column, got ${po1Cluster.length} xs=${xsAfter}`);
  }
  if (po2Notes.length < 1) {
    throw new Error('expected po2 column separate from po1');
  }
  console.log('partial_voice_osmd_align ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
