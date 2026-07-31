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

function countNums(host) {
  return [...host.querySelectorAll('text,tspan')].filter((e) => /^\d{1,3}$/.test((e.textContent || '').trim())).length;
}

function hideSpurious(host) {
  for (const svg of host.querySelectorAll('svg')) {
    for (const el of [...svg.querySelectorAll('text, tspan')]) {
      const t = (el.textContent || '').trim();
      if (/^\d{1,3}$/.test(t)) el.remove();
    }
  }
}

(async () => {
  const xml = prepXml(process.argv[2] || '_smoke/x/clean_score_only.xml');
  const host = document.getElementById('c');
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: true,
    backend: 'svg',
    drawMeasureNumbers: false,
    useXMLMeasureNumbers: false,
  });

  let renderCalls = 0;
  const orig = osmd.render.bind(osmd);
  osmd.render = () => {
    renderCalls += 1;
    osmd.EngravingRules.RenderMeasureNumbers = false;
    osmd.EngravingRules.UseXMLMeasureNumbers = false;
    orig();
    hideSpurious(host);
  };

  await osmd.load(xml);
  osmd.render();
  const afterFirst = countNums(host);

  // simulate resize like browser
  host.style.width = '800px';
  if (typeof osmd.autoResize === 'function') osmd.autoResize();
  else window.dispatchEvent(new Event('resize'));
  await new Promise((r) => setTimeout(r, 300));
  const afterResize = countNums(host);

  console.log(JSON.stringify({ renderCalls, afterFirst, afterResize, RenderMeasureNumbers: osmd.EngravingRules.RenderMeasureNumbers }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
