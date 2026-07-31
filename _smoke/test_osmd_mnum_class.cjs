const { JSDOM } = require('jsdom');
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');
const fs = require('fs');

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="c" style="width:1200px;height:2400px"></div></body></html>',
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

(async () => {
  const xml = fs
    .readFileSync('_smoke/x/clean_score_only.xml', 'utf8')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  const host = document.getElementById('c');
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
  await osmd.load(xml);
  osmd.render();
  const groups = [...host.querySelectorAll('g.measure-number, .measure-number')];
  const texts = [...host.querySelectorAll('text')].filter((t) => /^\d{1,3}$/.test((t.textContent || '').trim()));
  console.log(
    JSON.stringify({
      measureNumberGroups: groups.length,
      numericTexts: texts.length,
      firstGroupTag: groups[0]?.tagName,
      firstGroupHasTextChild: Boolean(groups[0]?.querySelector('text')),
    }),
  );
})();
