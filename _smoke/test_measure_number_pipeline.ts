/**
 * Test sanitize + measure-number suppress pipeline without full OSMD render.
 * Run: npx tsx _smoke/test_measure_number_pipeline.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import {
  removeAudiverisMeasureNumberingForOsmd,
  stripSpuriousMeasureNumberWordsForOsmd,
} from '../src/AudiverisInspectPanel.tsx';
import {
  enforceOsmdPreviewMeasureNumberRules,
  finalizeOsmdMeasureNumberPreview,
  patchOsmdRenderForMeasureNumbers,
} from '../src/osmdMeasureNumberSuppress.ts';

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:900px;height:800px;position:relative"></div></body></html>',
);
const g = globalThis as unknown as Record<string, unknown>;
g.document = dom.window.document;
g.window = dom.window;
g.navigator = dom.window.navigator;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;
g.SVGElement = dom.window.SVGElement;
g.requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
};

function loadXml(path: string): string {
  if (path.endsWith('.mxl')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AdmZip = require('adm-zip') as typeof import('adm-zip');
    const zip = new AdmZip(path);
    const entry = zip
      .getEntries()
      .find((e) => e.entryName.endsWith('.xml') && !e.entryName.toUpperCase().includes('META'));
    if (!entry) throw new Error('no xml in mxl');
    return entry.getData().toString('utf8');
  }
  return readFileSync(path, 'utf8');
}

function countMeasureNumbering(xml: string): number {
  return (xml.match(/<measure-numbering>/g) ?? []).length;
}

async function main() {
  const rawPath = process.argv[2] ?? 'debug_omr/audiveris_raw.mxl';
  let xml = loadXml(rawPath);
  xml = xml.replace(/<!DOCTYPE[\s\S]*?>/gi, '');

  const allowed = new Map<number, string>([
    [3, '3'],
    [6, '6'],
    [14, '14'],
  ]);

  let out = removeAudiverisMeasureNumberingForOsmd(xml);
  out = stripSpuriousMeasureNumberWordsForOsmd(out, allowed);
  console.log('after sanitize measure-numbering count', countMeasureNumbering(out));

  try {
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
    const host = document.getElementById('host') as HTMLDivElement;
    host.innerHTML = '';
    const osmd = new OpenSheetMusicDisplay(host, {
      autoResize: false,
      backend: 'svg',
      drawMeasureNumbers: false,
      useXMLMeasureNumbers: false,
    } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);

    let patchCalls = 0;
    patchOsmdRenderForMeasureNumbers(osmd, host, () => allowed);
    const orig = osmd.render.bind(osmd);
    osmd.render = () => {
      patchCalls += 1;
      enforceOsmdPreviewMeasureNumberRules(osmd);
      orig();
      finalizeOsmdMeasureNumberPreview(host, osmd, allowed);
    };

    await osmd.load(out);
    enforceOsmdPreviewMeasureNumberRules(osmd);
    osmd.render();

    const measureNumberNodes = host.querySelectorAll('.measure-number, [class*="measure-number"]');
    const numericText = [...host.querySelectorAll('text,tspan')]
      .map((e) => e.textContent?.trim() ?? '')
      .filter((t) => /^\d{1,3}$/.test(t));
    const overlay = host.querySelectorAll('[data-omr-measure-number-overlay] span');

    console.log(
      JSON.stringify(
        {
          patchCalls,
          RenderMeasureNumbers: osmd.EngravingRules.RenderMeasureNumbers,
          UseXMLMeasureNumbers: osmd.EngravingRules.UseXMLMeasureNumbers,
          measureNumberClassNodes: measureNumberNodes.length,
          numericSvgTextCount: numericText.length,
          numericSvgSample: numericText.slice(0, 20),
          htmlOverlayCount: overlay.length,
          htmlOverlayTexts: [...overlay].map((e) => e.textContent),
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.log('OSMD render skipped/failed:', e instanceof Error ? e.message : String(e));
  }
}

void main();
