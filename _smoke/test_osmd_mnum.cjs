const { JSDOM } = require('jsdom');
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');
const fs = require('fs');

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

let xml = fs.readFileSync('_smoke/x/clean_score_only.xml', 'utf8');
xml = xml.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
xml = xml.replace(/<measure-numbering>[\s\S]*?<\/measure-numbering>/g, '');

(async () => {
  const host = document.getElementById('c');
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawMeasureNumbers: false,
  });
  osmd.EngravingRules.RenderMeasureNumbers = false;
  osmd.EngravingRules.UseXMLMeasureNumbers = false;
  await osmd.load(xml);
  osmd.render();
  const nums = [...host.querySelectorAll('text,tspan')]
    .map((e) => e.textContent?.trim())
    .filter((t) => t && /^\d{1,3}$/.test(t));
  const sheet = osmd.GraphicSheet || osmd.graphic;
  const sys = sheet?.MusicPages?.[0]?.MusicSystems?.[0];
  console.log(
    JSON.stringify({
      RenderMeasureNumbers: osmd.EngravingRules.RenderMeasureNumbers,
      numericTextCount: nums.length,
      sample: nums.slice(0, 25),
      measureNumberLabels: sys?.measureNumberLabels?.length ?? sys?.MeasureNumberLabels?.length ?? null,
    }),
  );
})().catch((e) => {
  console.log('ERR', e.message);
  process.exit(1);
});
