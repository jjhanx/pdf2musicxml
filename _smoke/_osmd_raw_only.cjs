const fs = require('fs');
const { JSDOM } = require('jsdom');
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.Node = dom.window.Node;
global.requestAnimationFrame = (cb) => {
  setTimeout(() => cb(0), 0);
  return 0;
};

const host = document.getElementById('host');
host.style.width = '1400px';
host.style.height = '8000px';

const osmd = new OpenSheetMusicDisplay(host, {
  autoResize: false,
  backend: 'svg',
  drawMeasureNumbers: false,
});

osmd
  .load(fs.readFileSync('_smoke/_cheongsan_review.xml', 'utf8'))
  .then(() => {
    osmd.zoom = 0.35;
    return osmd.render();
  })
  .then(() => {
    const ms = osmd.GraphicSheet.MeasureList;
    for (const n of [24, 25, 26, 27, 28]) {
      const m = ms.filter((x) => Number(x.MeasureNumber ?? x.measureNumber) === n);
      let e = 0;
      for (const x of m) e += (x.staffEntries || x.VerticalSourceStaffEntryContainers || []).length;
      console.log('m' + n, 'parts', m.length, 'entries', e);
    }
  })
  .catch((e) => {
    const msg = e && (e.message || String(e));
    fs.writeFileSync('_smoke/_osmd_err.txt', msg + '\n' + (e.stack || ''));
    console.error('ERR', msg);
    process.exit(1);
  });
