const { JSDOM } = require('jsdom');
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');
const fs = require('fs');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="c" style="width:800px;height:600px"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.navigator = dom.window.navigator;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;

let xml = fs.readFileSync('_smoke/x/clean_score_only.xml', 'utf8');
xml = xml.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
xml = xml.replace(/<measure-numbering>[\s\S]*?<\/measure-numbering>/g, '');

(async () => {
  const osmd = new OpenSheetMusicDisplay(document.getElementById('c'), {
    autoResize: false,
    backend: 'svg',
    drawMeasureNumbers: false,
  });
  osmd.EngravingRules.RenderMeasureNumbers = false;
  osmd.EngravingRules.UseXMLMeasureNumbers = false;
  await osmd.load(xml);
  osmd.render();
  const nums = [...document.querySelectorAll('svg text, svg tspan')]
    .map((e) => e.textContent?.trim())
    .filter((t) => t && /^\d{1,3}$/.test(t));
  console.log(JSON.stringify({ count: nums.length, sample: nums.slice(0, 25) }));
})().catch((e) => {
  console.log('FAIL', e && e.message ? e.message : String(e));
  process.exit(1);
});
