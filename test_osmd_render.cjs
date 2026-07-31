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

function repairTimelineForOsmdPreview(xml) {
    const domParser = new global.DOMParser();
    const doc = domParser.parseFromString(xml, 'application/xml');
    doc.querySelectorAll('*[default-x]').forEach((e) => e.removeAttribute('default-x'));
    doc.querySelectorAll('*[default-y]').forEach((e) => e.removeAttribute('default-y'));
    doc.querySelectorAll('measure[width]').forEach((e) => e.removeAttribute('width'));
    doc.querySelectorAll('print').forEach((e) => e.remove());
    doc.querySelectorAll('measure').forEach(m => {
        let last = m.lastElementChild;
        while (last && (last.tagName === 'backup' || last.tagName === 'forward' || last.tagName === 'barline')) {
            const next = last.previousElementSibling;
            if (last.tagName === 'backup' || last.tagName === 'forward') {
                last.remove();
            }
            last = next;
        }
    });

    const serializer = new global.XMLSerializer();
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` + serializer.serializeToString(doc.documentElement);
}

function stripChordBeamsForOsmdPreview(xml) {
    const domParser = new global.DOMParser();
    const doc = domParser.parseFromString(xml, 'application/xml');
    const notes = doc.querySelectorAll('note');
    for (const note of notes) {
        if (note.querySelector('chord')) {
            const beams = note.querySelectorAll('beam');
            for (const beam of beams) {
                beam.remove();
            }
        }
    }
    const serializer = new global.XMLSerializer();
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n` + serializer.serializeToString(doc.documentElement);
}

async function main() {
  const xmlPath = 'C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml';
  const rawXml = fs.readFileSync(xmlPath, 'utf8');
  let xml = repairTimelineForOsmdPreview(rawXml);
  xml = stripChordBeamsForOsmdPreview(xml);

  const host = setupDom();
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    drawComposer: false,
    drawMeasureNumbers: true,
  });
  osmd.setLogLevel('error');
  await osmd.load(xml);
  osmd.render();
  
  // get svg output
  const svg = host.innerHTML;
  fs.writeFileSync('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/test_output_osmd.html', svg);
  console.log('Saved to test_output_osmd.html');
}

main().catch(console.error);
