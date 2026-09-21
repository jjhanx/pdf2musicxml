/**
 * clip rect must use AbsolutePosition×unitInPixels (not x=0), or right-side measures vanish.
 * Only overfull issues get clipped when issues[] is passed.
 * Run: npx tsx _smoke/test_clip_vf_measure_dom.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  allocatedMeasureWidthOsmd,
  clipOsmdMeasuresToAllocatedWidth,
} from '../src/osmdMeasureTimingWarning';
import {
  forEachGraphicalMeasure,
  getOsmdUnitInPixels,
  measureMxlFromGraphic,
  partIdFromGraphic,
} from '../src/osmdMeasureClick';
import type { MeasureTimingIssue } from '../shared/musicXmlMeasureTiming';

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
  Object.defineProperty(host, 'clientWidth', { get: () => 1200, configurable: true });
  Object.defineProperty(host, 'offsetWidth', { get: () => 1200, configurable: true });
  host.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 400,
      right: 1200,
      width: 1200,
      height: 400,
      toJSON() {},
    }) as DOMRect;
  const osmd = new OSMD!(host, { autoResize: false, backend: 'svg', drawTitle: false }) as {
    load: (x: string) => Promise<unknown>;
    render: () => void;
    IsReadyToRender: () => boolean;
    EngravingRules?: { PageFormat?: { width?: number } };
  };
  await osmd.load(xml);
  if (osmd.EngravingRules?.PageFormat) osmd.EngravingRules.PageFormat.width = 1200;
  osmd.render();
  assert.ok(osmd.IsReadyToRender(), 'OSMD ready');

  const scale = getOsmdUnitInPixels(osmd as never);

  // issues 없으면(undefined) 전체 clip — 좌표 검증용
  clipOsmdMeasuresToAllocatedWidth(host, osmd as never);
  const clippedAll = host.querySelectorAll('g.vf-measure[data-hitl-measure-clipped]');
  assert.ok(clippedAll.length >= 1, `expected clipped measures, got ${clippedAll.length}`);

  for (const g of clippedAll) {
    const cpUrl = g.getAttribute('clip-path') ?? '';
    const id = cpUrl.match(/#([^)]+)/)?.[1];
    assert.ok(id, 'clip-path id');
    const rect = host.querySelector(`[id="${id}"] rect`);
    assert.ok(rect, 'clip rect');
    const x = Number(rect!.getAttribute('x'));
    const w = Number(rect!.getAttribute('width'));
    assert.ok(Number.isFinite(x) && Number.isFinite(w) && w > 1, `clip x/w finite, got ${x},${w}`);
    // VexFlow 절대 좌표: 첫 마디가 원점 근처가 아니면 x=0이면 안 됨
    // (회귀: x=0 고정이면 오른쪽 마디가 흰색으로 사라짐)
  }

  // AbsolutePosition과 clip x 대응
  let matched = 0;
  forEachGraphicalMeasure(osmd as never, (gmRaw, _si, mi, row) => {
    const abs = (gmRaw as { PositionAndShape?: { AbsolutePosition?: { x?: number } } })
      .PositionAndShape?.AbsolutePosition?.x;
    if (abs == null || !Number.isFinite(abs)) return;
    const expectedX = abs * scale;
    const wUnits = allocatedMeasureWidthOsmd(gmRaw, row[mi + 1]);
    const expectedW = wUnits * scale;
    for (const g of clippedAll) {
      const cpUrl = g.getAttribute('clip-path') ?? '';
      const id = cpUrl.match(/#([^)]+)/)?.[1];
      const rect = id ? host.querySelector(`[id="${id}"] rect`) : null;
      if (!rect) continue;
      const x = Number(rect.getAttribute('x'));
      const w = Number(rect.getAttribute('width'));
      if (Math.abs(x - expectedX) < 0.5 && Math.abs(w - expectedW) < 0.5) matched += 1;
    }
  });
  assert.ok(matched >= 1, `clip x must match absX*uip (matched=${matched})`);

  // issues=[] → overfull 없음 → clip 없음
  clipOsmdMeasuresToAllocatedWidth(host, osmd as never, []);
  assert.equal(
    host.querySelectorAll('g.vf-measure[data-hitl-measure-clipped]').length,
    0,
    'empty issues → no clip',
  );

  // overfull issue만 clip
  let partId = 'P1';
  let measureNumber = 1;
  forEachGraphicalMeasure(osmd as never, (gmRaw) => {
    partId = partIdFromGraphic(gmRaw as never) || partId;
    measureNumber = measureMxlFromGraphic(gmRaw as never) ?? measureNumber;
  });
  const issues: MeasureTimingIssue[] = [
    {
      partId,
      measureNumber,
      kind: 'overfull',
      actual: 24,
      expected: 16,
    },
  ];
  clipOsmdMeasuresToAllocatedWidth(host, osmd as never, issues);
  const clippedOver = host.querySelectorAll('g.vf-measure[data-hitl-measure-clipped]');
  assert.ok(clippedOver.length >= 1, 'overfull issue clips at least one measure');
  assert.ok(
    clippedOver.length < clippedAll.length || clippedAll.length === 1,
    'overfull-only clips fewer than clip-all (or single-measure score)',
  );

  console.log('test_clip_vf_measure_dom: OK', {
    clippedAll: clippedAll.length,
    clippedOver: clippedOver.length,
    matched,
    scale,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
