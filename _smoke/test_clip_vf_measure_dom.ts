/**
 * clipOsmdMeasuresToAllocatedWidth must attach clip-path to real g.vf-measure
 * (GraphicalMeasure.getSVGGElement is often undefined — notes live under vf-measure).
 * Run: npx tsx _smoke/test_clip_vf_measure_dom.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import { clipOsmdMeasuresToAllocatedWidth } from '../src/osmdMeasureTimingWarning';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:1200px;height:400px"></div></body></html>',
  { pretendToBeVisual: true },
);
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>4</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>4</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>B</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  assert.ok(OSMD, 'OpenSheetMusicDisplay export');
  const host = document.getElementById('host') as HTMLElement;
  const osmd = new OSMD!(host, { autoResize: false, backend: 'svg', drawTitle: false }) as {
    load: (x: string) => Promise<unknown>;
    render: () => void;
    IsReadyToRender: () => boolean;
  };
  await osmd.load(xml);
  osmd.render();
  assert.ok(osmd.IsReadyToRender(), 'OSMD ready');

  clipOsmdMeasuresToAllocatedWidth(host, osmd as never);

  const clipped = host.querySelectorAll('g.vf-measure[data-hitl-measure-clipped]');
  assert.ok(
    clipped.length >= 1,
    `expected clipped g.vf-measure, got ${clipped.length} (getSVGGElement-only lookup would yield 0)`,
  );
  for (const g of clipped) {
    const cp = g.getAttribute('clip-path') ?? '';
    assert.ok(/^url\(#hitl-mclip-\d+\)$/.test(cp), `clip-path on vf-measure, got ${cp}`);
  }
  const defs = host.querySelectorAll('clipPath[data-hitl-measure-clip]');
  assert.equal(defs.length, clipped.length, 'one clipPath per clipped measure');

  // 음표가 clip 대상 마디 G 안에 있어야 앞 마디 침범이 clip으로 막힘
  const note = host.querySelector('.vf-stavenote');
  assert.ok(note, 'stavenote present');
  const parentMeasure = note!.closest('g.vf-measure');
  assert.ok(parentMeasure, 'stavenote under vf-measure');
  assert.ok(
    parentMeasure!.hasAttribute('data-hitl-measure-clipped'),
    'note parent measure must be clipped',
  );

  console.log('test_clip_vf_measure_dom: OK', { clipped: clipped.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
