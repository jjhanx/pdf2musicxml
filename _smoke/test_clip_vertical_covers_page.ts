/**
 * Measure clip vertical band must cover the full SVG page — fixed y=-800/h=2400
 * clipped lower staves (T/B/PR) white while S/A stayed visible on straddling systems.
 * Run: npx tsx _smoke/test_clip_vertical_covers_page.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import {
  clipOsmdMeasuresToAllocatedWidth,
  measureClipVerticalBandPx,
  osmdGraphicalMeasureSvgG,
} from '../src/osmdMeasureTimingWarning';
import {
  forEachGraphicalMeasure,
  measureMxlFromGraphic,
  partIdFromGraphic,
} from '../src/osmdMeasureClick';

const require = createRequire(import.meta.url);
const osmdPkg = require('opensheetmusicdisplay');
const OpenSheetMusicDisplay =
  osmdPkg.OpenSheetMusicDisplay ?? osmdPkg.default?.OpenSheetMusicDisplay ?? osmdPkg.default;

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:900px;height:400px"></div></body></html>',
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

// Unit: viewBox → tall band
{
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1000 9000');
  const band = measureClipVerticalBandPx(svg);
  assert.ok(band.y <= -4000, `y pad above page, got ${band.y}`);
  assert.ok(band.y + band.height >= 9000 + 4000, `covers below page, end=${band.y + band.height}`);
  assert.ok(band.height > 9000, `height > viewBox h, got ${band.height}`);
}

// Unit: zero-width viewBox → clip skipped (no white wipe)
{
  const host = document.getElementById('host')!;
  host.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 0 5000');
  svg.setAttribute('width', '0');
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'vf-measure');
  svg.appendChild(g);
  host.appendChild(svg);
  const stub = {
    IsReadyToRender: () => true,
    zoom: 1,
    GraphicSheet: { MeasureList: [] },
    Drawer: { rules: { unitInPixels: 10 } },
  };
  clipOsmdMeasuresToAllocatedWidth(host, stub as never);
  assert.equal(
    host.querySelectorAll('clipPath[data-hitl-measure-clip]').length,
    0,
    'skip clip when viewBox width is 0',
  );
}

// Integration: multi-staff tall page — lower-staff path Y must stay inside clip rect
{
  const host = document.getElementById('host')!;
  host.innerHTML = '';
  Object.defineProperty(host, 'clientWidth', { get: () => 1100, configurable: true });
  Object.defineProperty(host, 'offsetWidth', { get: () => 1100, configurable: true });
  host.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 800,
      right: 1100,
      width: 1100,
      height: 800,
      toJSON() {},
    }) as DOMRect;

  const parts = ['P1', 'P2', 'P3', 'P4', 'P5'];
  const partList = parts
    .map((id) => `<score-part id="${id}"><part-name>${id}</part-name></score-part>`)
    .join('');
  const makeMeasures = (n: number, withPianoStaff2 = false) => {
    const ms: string[] = [];
    for (let i = 1; i <= n; i += 1) {
      const attrs =
        i === 1
          ? `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>${
              withPianoStaff2
                ? '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>'
                : '<clef><sign>G</sign><line>2</line></clef>'
            }</attributes>`
          : '';
      if (withPianoStaff2) {
        ms.push(
          `<measure number="${i}">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><staff>1</staff></note><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>whole</type><staff>2</staff></note></measure>`,
        );
      } else {
        ms.push(
          `<measure number="${i}">${attrs}<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>`,
        );
      }
    }
    return ms.join('');
  };
  const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list>${partList}</part-list>
  ${parts.map((id) => `<part id="${id}">${makeMeasures(24, id === 'P5')}</part>`).join('\n')}
</score-partwise>`;

  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
  });
  await osmd.load(xml);
  const rules = osmd.EngravingRules as {
    BetweenStaffDistance?: number;
    StaffDistance?: number;
    SoftmaxFactorVexFlow?: number;
    PageFormat?: { width?: number };
  };
  rules.BetweenStaffDistance = 8;
  rules.StaffDistance = 8.5;
  if (typeof rules.SoftmaxFactorVexFlow === 'number') rules.SoftmaxFactorVexFlow = 200;
  if (rules.PageFormat) rules.PageFormat.width = 1100;
  osmd.zoom = 0.6;
  osmd.render();
  clipOsmdMeasuresToAllocatedWidth(host, osmd);

  const svg = host.querySelector('svg');
  assert.ok(svg, 'svg');
  const vbW = Number((svg!.getAttribute('viewBox') || '0 0 0 0').split(/\s+/)[2]);
  assert.ok(vbW > 1, `expected laid-out viewBox width, got ${vbW}`);

  let checked = 0;
  forEachGraphicalMeasure(osmd, (gm, si) => {
    const mnum = measureMxlFromGraphic(gm as never);
    if (mnum == null || mnum < 12) return;
    const g = osmdGraphicalMeasureSvgG(gm);
    if (!g) return;
    const clip = g.getAttribute('clip-path') || '';
    const id = /url\(#([^)]+)\)/.exec(clip)?.[1];
    if (!id) return;
    const rectEl =
      [...host.querySelectorAll('clipPath[data-hitl-measure-clip]')].find((cp) => cp.id === id)
        ?.querySelector('rect') ?? null;
    assert.ok(rectEl, `clip rect for ${partIdFromGraphic(gm as never)} m${mnum}`);
    const y0 = Number(rectEl!.getAttribute('y'));
    const h = Number(rectEl!.getAttribute('height'));
    const y1 = y0 + h;
    assert.ok(h > 2400, `clip height must exceed old fixed 2400, got ${h}`);
    let pathMin = Infinity;
    let pathMax = -Infinity;
    for (const p of g.querySelectorAll('path')) {
      const d = p.getAttribute('d') || '';
      const re = /[MmLlCcSs]\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(d))) {
        const yy = parseFloat(m[2]!);
        if (!Number.isFinite(yy)) continue;
        pathMin = Math.min(pathMin, yy);
        pathMax = Math.max(pathMax, yy);
      }
    }
    if (!Number.isFinite(pathMin)) return;
    assert.ok(
      pathMin >= y0 && pathMax <= y1,
      `m${mnum} si${si} ${partIdFromGraphic(gm as never)} path Y ${pathMin}..${pathMax} outside clip ${y0}..${y1}`,
    );
    checked += 1;
  });
  assert.ok(checked >= 5, `expected several measures checked, got ${checked}`);
  // 세로 밴드는 viewBox 기준 — 단편 악보라도 구 고정값(2400)보다 커야 함(위 assert h>2400).
}

console.log('ok: clip vertical covers full page');
