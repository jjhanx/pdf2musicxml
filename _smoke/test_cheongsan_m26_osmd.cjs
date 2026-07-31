/**
 * OSMD: full 청산 score — m25 orphan backup vs cleaned
 * Run: node _smoke/test_cheongsan_m26_osmd.cjs
 */
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

function m26EntryCount(osmd) {
  const measures = osmd.GraphicSheet?.MeasureList ?? [];
  const m26 = measures.filter((m) => Number(m.MeasureNumber ?? m.measureNumber) === 26);
  let n = 0;
  for (const m of m26) n += (m.staffEntries ?? m.VerticalSourceStaffEntryContainers ?? []).length;
  return { m26parts: m26.length, entries: n, totalMeasures: measures.length };
}

async function runCase(label, xmlPath) {
  const host = setupDom();
  host.style.width = '1400px';
  host.style.height = '8000px';
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    drawComposer: false,
    drawMeasureNumbers: false,
  });
  await osmd.load(xml);
  osmd.zoom = 0.35;
  osmd.render();
  const stats = m26EntryCount(osmd);
  console.log(label, stats);
  return stats;
}

async function main() {
  for (const p of ['_smoke/_cheongsan_review.xml', '_smoke/_cheongsan_review_nobackup.xml']) {
    if (!fs.existsSync(p)) throw new Error('missing ' + p);
  }
  const raw = await runCase('full raw', '_smoke/_cheongsan_review.xml');
  const clean = await runCase('full nobackup', '_smoke/_cheongsan_review_nobackup.xml');
  if (raw.entries === 0 && clean.entries > 0) {
    console.log('REPRO: orphan backup clears m26');
  } else if (raw.entries === 0 && clean.entries === 0) {
    throw new Error('m26 empty even after backup cleanup — other cause');
  } else if (raw.entries > 0) {
    console.log('raw already has m26 entries — backup not the only issue in node test');
  }
  if (clean.entries < 4) throw new Error('cleaned score m26 still too empty: ' + clean.entries);
  console.log('cheongsan m26 osmd cjs ok');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
