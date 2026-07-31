const fs = require('fs');
const { JSDOM } = require('jsdom');
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.DOMParser = dom.window.DOMParser;
  global.XMLSerializer = dom.window.XMLSerializer;
  global.Node = dom.window.Node;
  global.HTMLElement = dom.window.HTMLElement;
  global.SVGElement = dom.window.SVGElement;
  global.requestAnimationFrame = (cb) => {
    setTimeout(() => cb(0), 0);
    return 0;
  };
  return dom.window.document.getElementById('host');
}

async function main() {
  const xmlPath = 'C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml';
  const host = setupDom();
  
  const domParser = new global.DOMParser();
  const doc = domParser.parseFromString(fs.readFileSync(xmlPath, 'utf8'), 'application/xml');
  
  doc.querySelectorAll('print').forEach(e => e.remove());
  doc.querySelectorAll('measure[width]').forEach(e => e.removeAttribute('width'));
  doc.querySelectorAll('*[default-x]').forEach(e => e.removeAttribute('default-x'));
  doc.querySelectorAll('*[default-y]').forEach(e => e.removeAttribute('default-y'));
  
  const serializer = new global.XMLSerializer();
  const xmlBase = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` + serializer.serializeToString(doc.documentElement);
  
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
  osmd.setLogLevel('error');
  await osmd.load(xmlBase);
  osmd.render();
  
  const gm = osmd.GraphicSheet?.MeasureList ?? [];
  for (const mList of gm) {
      if (mList && mList[0]) {
          const num = mList[0].MeasureNumber;
          if (num >= 25 && num <= 27) {
              const b = mList[0].PositionAndShape.AbsolutePosition;
              const w = mList[0].PositionAndShape.Size.width;
              console.log(`M${num} AbsPos: x=${b?.x}, y=${b?.y}, w=${w}`);
          }
      }
  }
}

main().catch(console.error);
