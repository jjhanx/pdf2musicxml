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

function extractM26AndRepair(xml) {
    const domParser = new global.DOMParser();
    const doc = domParser.parseFromString(xml, 'application/xml');
    
    const parts = doc.querySelectorAll('part');
    for (const part of parts) {
        const m1 = part.querySelector('measure[number="1"]');
        let attrs = null;
        if (m1) attrs = m1.querySelector('attributes');
        
        const measures = Array.from(part.querySelectorAll('measure'));
        for (const m of measures) {
            const num = m.getAttribute('number');
            if (num === '26') {
                if (attrs && !m.querySelector('attributes')) {
                    m.insertBefore(attrs.cloneNode(true), m.firstChild);
                }
                
                // STRIP BACKUPS AND FORWARDS!
                m.querySelectorAll('backup').forEach(e => e.remove());
                m.querySelectorAll('forward').forEach(e => e.remove());
                
            } else {
                m.remove();
            }
        }
    }
    
    doc.querySelectorAll('*[default-x]').forEach((e) => e.removeAttribute('default-x'));
    doc.querySelectorAll('*[default-y]').forEach((e) => e.removeAttribute('default-y'));
    doc.querySelectorAll('print').forEach((e) => e.remove());
    doc.querySelectorAll('measure[width]').forEach((e) => e.removeAttribute('width'));
    
    const serializer = new global.XMLSerializer();
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` + serializer.serializeToString(doc.documentElement);
}

async function main() {
  const xmlPath = 'C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml';
  const host = setupDom();
  const xmlBase = extractM26AndRepair(fs.readFileSync(xmlPath, 'utf8'));
  
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawMeasureNumbers: false });
  osmd.setLogLevel('error');
  await osmd.load(xmlBase);
  osmd.render();
  
  const gm = osmd.GraphicSheet?.MeasureList ?? [];
  let w = null;
  for (const m of gm) {
      if (m[0]) {
          w = m[0].PositionAndShape?.Size?.width;
      }
  }
  console.log(`Isolated M26 width WITHOUT BACKUPS: ${w}`);
}

main().catch(console.error);
