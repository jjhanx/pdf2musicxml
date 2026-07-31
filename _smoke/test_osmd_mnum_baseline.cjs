const { JSDOM } = require('jsdom');
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');
const fs = require('fs');

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="c" style="width:1200px;height:2400px;position:relative"></div></body></html>',
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

function prepXml(p) {
  let xml = fs.readFileSync(p, 'utf8');
  xml = xml.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  return xml;
}

function stats(host, osmd, label) {
  const mnumClass = host.querySelectorAll('.measure-number');
  const nums = [...host.querySelectorAll('text,tspan')]
    .map((e) => ({ t: e.textContent?.trim(), cls: e.getAttribute('class'), tag: e.tagName }))
    .filter((x) => x.t && /^\d{1,3}$/.test(x.t));
  const sheet = osmd.GraphicSheet || osmd.graphic;
  let labelCount = 0;
  for (const page of sheet?.MusicPages || []) {
    for (const sys of page.MusicSystems || []) {
      labelCount += (sys.measureNumberLabels || sys.MeasureNumberLabels || []).length;
    }
  }
  console.log(
    JSON.stringify({
      label,
      RenderMeasureNumbers: osmd.EngravingRules.RenderMeasureNumbers,
      UseXMLMeasureNumbers: osmd.EngravingRules.UseXMLMeasureNumbers,
      graphicLabelCount: labelCount,
      measureNumberClassNodes: mnumClass.length,
      numericTextCount: nums.length,
      numericSample: nums.slice(0, 15),
    }),
  );
}

(async () => {
  const sample = process.argv[2] || '_smoke/x/clean_score_only.xml';
  const xmlRaw = prepXml(sample);
  const xmlNoMn = xmlRaw.replace(/<measure-numbering>[\s\S]*?<\/measure-numbering>/g, '');

  for (const [label, xml, opts, rules] of [
    [
      'OSMD defaults (measure-numbering intact)',
      xmlRaw,
      { autoResize: false, backend: 'svg' },
      {},
    ],
    [
      'OSMD defaults (measure-numbering stripped)',
      xmlNoMn,
      { autoResize: false, backend: 'svg' },
      {},
    ],
    [
      'drawMeasureNumbers false (mn stripped)',
      xmlNoMn,
      { autoResize: false, backend: 'svg', drawMeasureNumbers: false, useXMLMeasureNumbers: false },
      { RenderMeasureNumbers: false, UseXMLMeasureNumbers: false },
    ],
  ]) {
    const host = document.getElementById('c');
    host.innerHTML = '';
    const osmd = new OpenSheetMusicDisplay(host, opts);
    for (const [k, v] of Object.entries(rules)) osmd.EngravingRules[k] = v;
    await osmd.load(xml);
    osmd.render();
    stats(host, osmd, label);
  }
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
