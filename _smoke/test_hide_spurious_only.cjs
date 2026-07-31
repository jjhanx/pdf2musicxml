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
  return fs
    .readFileSync(p, 'utf8')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<measure-numbering>[\s\S]*?<\/measure-numbering>/g, '');
}

function hideSpurious(host) {
  for (const svg of host.querySelectorAll('svg')) {
    for (const el of [...svg.querySelectorAll('text, tspan')]) {
      const t = (el.textContent || '').trim();
      if (/^\d{1,3}$/.test(t)) el.remove();
    }
  }
}

function count(host) {
  return [...host.querySelectorAll('text,tspan')].filter((e) => /^\d{1,3}$/.test((e.textContent || '').trim())).length;
}

(async () => {
  const host = document.getElementById('c');
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
  await osmd.load(prepXml(process.argv[2] || '_smoke/x/clean_score_only.xml'));
  osmd.render();
  const before = count(host);
  hideSpurious(host);
  const after = count(host);
  console.log(JSON.stringify({ before, after }));
})();
