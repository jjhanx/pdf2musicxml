const fs = require('fs');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:900px;height:2000px"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.navigator = dom.window.navigator;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;

const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

function firstPitchInMeasure(osmd, mxl) {
  const list = osmd.GraphicSheet?.MeasureList || [];
  for (const m of list) {
    const n = Number(m.MeasureNumber ?? m.measureNumber ?? 0);
    if (n !== mxl) continue;
    const entries = m.staffEntries || m.VerticalSourceStaffEntryContainers || [];
    if (!entries.length) return null;
    const entry = entries[0];
    const notes = entry?.graphicalVoiceEntries || entry?.GraphicalVoiceEntries || [];
    if (!notes.length) return 'empty-entry';
    return 'has-notes';
  }
  return 'MISSING';
}

async function render(label, path) {
  const xml = fs.readFileSync(path, 'utf8');
  const host = document.getElementById('host');
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    drawComposer: false,
    drawMeasureNumbers: true,
  });
  await osmd.load(xml);
  osmd.render();
  const stats = {};
  for (const n of [25, 26, 27]) stats[n] = firstPitchInMeasure(osmd, n);
  console.log(label, stats);
  return stats;
}

(async () => {
  const raw = await render('RAW snippet', '_smoke/_cheongsan_p1_m24_28.xml');
  const clean = await render('CLEAN snippet', '_smoke/_cheongsan_p1_m24_28_clean.xml');
  if (raw[26] === 'MISSING' && clean[26] === 'has-notes') {
    console.log('cleanup fixes m26 render');
  }
  if (clean[26] === 'MISSING' || clean[26] === null) {
    throw new Error('cleaned m26 still missing: ' + clean[26]);
  }
  console.log('ok');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
