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
  return xml.replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<measure-numbering>[\s\S]*?<\/measure-numbering>/g, '');
}

(async () => {
  const xml = prepXml('_smoke/x/clean_score_only.xml');
  const host = document.getElementById('c');

  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawMeasureNumbers: false,
    useXMLMeasureNumbers: false,
  });

  console.log('after ctor', osmd.EngravingRules.RenderMeasureNumbers);

  await osmd.load(xml);

  console.log('after load osmd.rules', osmd.EngravingRules.RenderMeasureNumbers);
  const ms = osmd.Sheet ?? osmd.sheet ?? osmd.musicSheet;
  if (ms?.Rules) console.log('after load sheet.Rules', ms.Rules.RenderMeasureNumbers);

  osmd.EngravingRules.RenderMeasureNumbers = false;
  if (ms?.Rules) ms.Rules.RenderMeasureNumbers = false;

  osmd.render();

  const mnum = host.querySelectorAll('.measure-number').length;
  const nums = [...host.querySelectorAll('text,tspan')].filter((e) => /^\d{1,3}$/.test((e.textContent || '').trim())).length;
  console.log(JSON.stringify({ mnumClass: mnum, numericText: nums }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
