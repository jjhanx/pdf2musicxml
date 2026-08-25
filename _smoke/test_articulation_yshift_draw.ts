/**
 * Accent 거리 — 해당 글리프 transform만 이동 (전역 .vf-modifiers 래핑 금지).
 * Run: npx tsx _smoke/test_articulation_yshift_draw.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import {
  applyOsmdArticulationOffsets,
  applyPendingArticulationOffsetsOnly,
  extraYPxFromArticulationFixes,
  registerOsmdArticulationFixes,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix';
import { registerOsmdPreviewXmlForAlign } from '../src/osmdOnsetColumnAlignFix';
import { patchOsmdRenderForMeasureNumbers } from '../src/osmdMeasureNumberSuppress';

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
    queueMicrotask: (cb: () => void) => Promise.resolve().then(cb),
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 0;
    },
  });
  const proto = dom.window.SVGGraphicsElement.prototype as SVGGraphicsElement;
  if (!proto.getBBox) {
    proto.getBBox = function () {
      return { x: 0, y: 0, width: 10, height: 10 } as DOMRect;
    };
  }
  return dom;
}

function accentShiftY(host: HTMLElement): number | null {
  const el = host.querySelector('.vf-modifiers [data-art-shift-y], .vf-modifiers[data-art-shift-y]');
  if (!el) return null;
  return parseFloat(el.getAttribute('data-art-shift-y') ?? '');
}

async function main() {
  setupDom();
  const xml = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name/></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type><stem>up</stem><notations><articulations><accent placement="below"/></articulations></notations></note></measure></part></score-partwise>`;

  const host = document.createElement('div');
  host.className = 'omr-osmd-clickable';
  host.style.width = '800px';
  host.style.height = '400px';
  document.body.appendChild(host);

  const osmd = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
  patchOsmdRenderForMeasureNumbers(osmd, host, () => undefined);
  registerOsmdPreviewXmlForAlign(osmd, xml);
  registerOsmdPreviewXmlForArticulation(osmd, xml);
  await osmd.load(xml);
  osmd.zoom = 1;
  osmd.render();

  const fixes = [
    {
      kind: 'setArticulationPlacement' as const,
      partId: 'P1',
      measureMxl: 1,
      noteIndex: 0,
      articulation: 'accent',
      placement: 'below' as const,
      distance: '5',
      pitchStep: 'F',
      pitchAlter: 1,
      pitchOctave: 4,
    },
  ];
  const extra = extraYPxFromArticulationFixes(fixes, 10);
  assert.equal(extra, 40, '5칸 = OSMD 1칸 대비 +40px (라벨 50px는 MXL default-y 절대값)');
  assert.equal(host.querySelectorAll('g[data-hitl-art-wrap]').length, 0, 'no global wraps');

  const softN = applyPendingArticulationOffsetsOnly(host, osmd, fixes);
  assert.ok(softN >= 1, `expected soft shift, got ${softN}`);
  assert.equal(host.getAttribute('data-hitl-art-dy'), '40');
  assert.equal(accentShiftY(host), 40);

  // 전역 래퍼가 생기면 안 됨
  assert.equal(host.querySelectorAll('g[data-hitl-art-wrap]').length, 0);

  osmd.render();
  applyOsmdArticulationOffsets(host, osmd);
  assert.equal(host.getAttribute('data-hitl-art-dy'), '40');
  assert.equal(accentShiftY(host), 40, 're-applied after render');

  // pending 비움 → XML 힌트만 (이 XML은 distance attr 없음 → dy 0)
  applyPendingArticulationOffsetsOnly(host, osmd, []);
  assert.ok(
    accentShiftY(host) == null || accentShiftY(host) === 0,
    'cleared pending should not keep non-zero shift',
  );
  // dy=0 attrs may remain; host dy must be 0
  assert.equal(host.getAttribute('data-hitl-art-dy'), '0');

  // XML에 distance=5 반영된 경우 MXL 반영 후에도 이동
  const xml5 = xml.replace(
    '<accent placement="below"/>',
    '<accent placement="below" default-y="-50" data-hitl-art-distance="5"/>',
  );
  registerOsmdPreviewXmlForArticulation(osmd, xml5);
  registerOsmdArticulationFixes(osmd, []);
  await osmd.load(xml5);
  osmd.render();
  applyOsmdArticulationOffsets(host, osmd);
  assert.equal(accentShiftY(host), 40, 'XML distance=5 must shift without pending');
  assert.equal(host.getAttribute('data-hitl-art-dy'), '40');

  // XML에 distance=3 (사용자 재현) — pending 없이 유지
  const xml3 = xml.replace(
    '<accent placement="below"/>',
    '<accent placement="below" default-y="-30" data-hitl-art-distance="3"/>',
  );
  registerOsmdPreviewXmlForArticulation(osmd, xml3);
  registerOsmdArticulationFixes(osmd, []);
  await osmd.load(xml3);
  osmd.render();
  applyOsmdArticulationOffsets(host, osmd);
  assert.equal(accentShiftY(host), 20, 'XML distance=3 must shift without pending');
  assert.equal(host.getAttribute('data-hitl-art-dy'), '20');

  // UI: MXL 반영 후 pending 비움 + artPreviewFixes(같은 fixes) 유지 → 원위치 복귀 방지
  await osmd.load(xml3);
  osmd.render();
  const committed = applyPendingArticulationOffsetsOnly(host, osmd, fixes);
  assert.ok(committed >= 1, 'committed artPreviewFixes must shift after apply');
  assert.equal(accentShiftY(host), 40);

  // Audiveris 절대 default-y만 있으면 미리보기 Δ 금지 (전 악보 점프 방지)
  const xmlAud = xml.replace(
    '<accent placement="below"/>',
    '<accent placement="below" default-y="-78"/>',
  );
  registerOsmdPreviewXmlForArticulation(osmd, xmlAud);
  registerOsmdArticulationFixes(osmd, []);
  await osmd.load(xmlAud);
  osmd.render();
  applyOsmdArticulationOffsets(host, osmd);
  assert.ok(
    accentShiftY(host) == null || accentShiftY(host) === 0,
    'Audiveris absolute default-y must not drive preview Δ',
  );

  console.log('articulation glyph-targeted dy ok', { extra });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
