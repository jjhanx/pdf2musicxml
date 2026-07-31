const { JSDOM } = require('jsdom');
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');
const fs = require('fs');
const path = require('path');

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="c" style="width:900px;height:1200px;position:relative"></div></body></html>',
);
global.document = dom.window.document;
global.window = dom.window;
global.navigator = dom.window.navigator;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;

function loadXml(p) {
  let xml = fs.readFileSync(p, 'utf8');
  xml = xml.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  xml = xml.replace(/<measure-numbering>[\s\S]*?<\/measure-numbering>/g, '');
  return xml;
}

function hideSpurious(root) {
  for (const svg of root.querySelectorAll('svg')) {
    for (const el of [...svg.querySelectorAll('text, tspan')]) {
      const t = (el.textContent || '').trim();
      if (/^\d{1,3}$/.test(t)) el.remove();
    }
  }
}

function suppressGraphics(osmd) {
  const sheet = osmd.GraphicSheet || osmd.graphic;
  const pages = sheet?.MusicPages || sheet?.musicPages || [];
  for (const page of pages) {
    for (const sys of page.MusicSystems || page.musicSystems || []) {
      const labels = sys.measureNumberLabels || sys.MeasureNumberLabels || [];
      for (const label of labels) {
        if (label) {
          label.Visible = false;
          label.visible = false;
        }
      }
    }
  }
}

(async () => {
  const sample = process.argv[2] || '_smoke/x/clean_score_only.xml';
  const xml = loadXml(sample);
  const host = document.getElementById('c');

  const scenarios = [
    { name: 'defaults', opts: { autoResize: false, backend: 'svg' }, rules: {} },
    {
      name: 'drawMeasureNumbers_false',
      opts: { autoResize: false, backend: 'svg', drawMeasureNumbers: false, useXMLMeasureNumbers: false },
      rules: { RenderMeasureNumbers: false, UseXMLMeasureNumbers: false },
    },
  ];

  for (const sc of scenarios) {
    host.innerHTML = '';
    const osmd = new OpenSheetMusicDisplay(host, sc.opts);
    for (const [k, v] of Object.entries(sc.rules)) osmd.EngravingRules[k] = v;

    let patchCalls = 0;
    const orig = osmd.render.bind(osmd);
    osmd.render = () => {
      patchCalls += 1;
      osmd.EngravingRules.RenderMeasureNumbers = false;
      osmd.EngravingRules.UseXMLMeasureNumbers = false;
      orig();
      suppressGraphics(osmd);
      hideSpurious(host);
    };

    await osmd.load(xml);
    osmd.EngravingRules.RenderMeasureNumbers = false;
    osmd.render();

    const mnumClass = host.querySelectorAll('.measure-number').length;
    const nums = [...host.querySelectorAll('text,tspan')]
      .map((e) => e.textContent?.trim())
      .filter((t) => t && /^\d{1,3}$/.test(t));

    console.log(
      JSON.stringify({
        scenario: sc.name,
        sample: path.basename(sample),
        patchCalls,
        RenderMeasureNumbers: osmd.EngravingRules.RenderMeasureNumbers,
        measureNumberClassNodes: mnumClass,
        numericTextCount: nums.length,
        numericSample: [...new Set(nums)].slice(0, 25),
      }),
    );
  }
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
