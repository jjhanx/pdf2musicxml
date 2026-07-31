const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:920px"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle;

const xml = fs.readFileSync(path.join(__dirname, 'diag_82157_score.xml'), 'utf8');
const host = document.getElementById('host');
const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });

osmd.load(xml).then(() => {
  osmd.zoom = 0.55;
  osmd.render();
  const svg = host.querySelector('svg');
  const lines = [...svg.querySelectorAll('line')];
  const paths = [...svg.querySelectorAll('path')];
  console.log('lines', lines.length, 'paths', paths.length);
  const longLines = lines.filter((ln) => Math.abs(Number(ln.getAttribute('x2')) - Number(ln.getAttribute('x1'))) > 50);
  console.log('long lines', longLines.length);
  const ys = longLines.map((ln) => Number(ln.getAttribute('y1'))).sort((a, b) => a - b);
  console.log('first 20 y', ys.slice(0, 20).map((y) => y.toFixed(1)).join(', '));
  const rects = [...svg.querySelectorAll('rect')].filter((r) => Number(r.getAttribute('width')) > 50);
  console.log('wide rects', rects.length);
});
