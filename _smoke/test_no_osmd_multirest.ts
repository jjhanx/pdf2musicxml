/**
 * OMR 미리보기 — OSMD가 연속 온쉼 마디를 다중쉼표(굵은 선+숫자)로 접지 않는지.
 * Run: npx tsx _smoke/test_no_osmd_multirest.ts
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
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

const REST_ONLY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>S</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><rest/><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><rest/><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="3">
      <note><rest/><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="4">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

type SourceMeasureLike = {
  isReducedToMultiRest?: boolean;
  multipleRestMeasures?: number;
};

function reducedCount(osmd: { Sheet?: { SourceMeasures?: SourceMeasureLike[] } }): number {
  const measures = osmd.Sheet?.SourceMeasures ?? [];
  return measures.filter((m) => Boolean(m.isReducedToMultiRest) || (m.multipleRestMeasures ?? 0) > 1)
    .length;
}

function applyPreviewMultiRestOff(rules: {
  RenderMultipleRestMeasures?: boolean;
  AutoGenerateMultipleRestMeasuresFromRestMeasures?: boolean;
}): void {
  rules.RenderMultipleRestMeasures = false;
  rules.AutoGenerateMultipleRestMeasuresFromRestMeasures = false;
}

async function main() {
  const src = readFileSync('src/AudiverisInspectPanel.tsx', 'utf8');
  if (!src.includes('r.RenderMultipleRestMeasures = false')) {
    throw new Error('AudiverisInspectPanel must disable RenderMultipleRestMeasures');
  }
  if (!src.includes('r.AutoGenerateMultipleRestMeasuresFromRestMeasures = false')) {
    throw new Error('AudiverisInspectPanel must disable AutoGenerateMultipleRestMeasuresFromRestMeasures');
  }
  if (!src.includes('autoGenerateMultipleRestMeasuresFromRestMeasures: false')) {
    throw new Error('OSMD constructor must pass autoGenerateMultipleRestMeasuresFromRestMeasures: false');
  }

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host')!;

  const defaultOsmd = new OpenSheetMusicDisplay(host, { backend: 'svg', autoResize: false });
  await defaultOsmd.load(REST_ONLY_XML);
  console.log('default OSMD collapsed rest measures:', reducedCount(defaultOsmd));

  host.innerHTML = '';
  const previewOsmd = new OpenSheetMusicDisplay(host, {
    backend: 'svg',
    autoResize: false,
    autoGenerateMultipleRestMeasuresFromRestMeasures: false,
  });
  applyPreviewMultiRestOff(previewOsmd.EngravingRules);
  await previewOsmd.load(REST_ONLY_XML);
  const previewReduced = reducedCount(previewOsmd);
  if (previewReduced !== 0) {
    throw new Error(`preview rules still collapsed ${previewReduced} measures into multi-rest`);
  }
  const n = previewOsmd.Sheet?.SourceMeasures?.length ?? 0;
  if (n !== 4) throw new Error(`expected 4 source measures, got ${n}`);
  console.log('ok preview does not auto-generate multi-rests');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
