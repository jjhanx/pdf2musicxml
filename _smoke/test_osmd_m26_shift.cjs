/**
 * OSMD m26 shift — raw vs cleaned full score
 * Run: node _smoke/test_osmd_m26_shift.cjs
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1400px;height:8000px"></div></body></html>');
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

async function graphicByMeasure(osmd) {
  const list = osmd.GraphicSheet?.MeasureList || [];
  const byNum = new Map();
  for (const m of list) {
    const n = Number(m.MeasureNumber ?? m.measureNumber ?? 0);
    const entries = (m.staffEntries ?? m.VerticalSourceStaffEntryContainers ?? []).length;
    const prev = byNum.get(n) || 0;
    byNum.set(n, prev + entries);
  }
  return byNum;
}

async function render(label, xml) {
  const host = document.getElementById('host');
  host.innerHTML = '';
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
  const g = await graphicByMeasure(osmd);
  console.log(label);
  for (const n of [24, 25, 26, 27, 28]) {
    console.log(`  m${n} graphicEntries=${g.get(n) ?? 'MISSING'}`);
  }
  return g;
}

async function main() {
  const raw = fs.readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const cleaned = fs.readFileSync('_smoke/_cheongsan_cleaned.xml', 'utf8');
  let rawG;
  try {
    rawG = await render('RAW', raw);
  } catch (e) {
    console.log('RAW failed:', e.message || String(e));
  }
  const cleanG = await render('CLEANED', cleaned);
  const e26 = cleanG.get(26) ?? 0;
  const e27 = cleanG.get(27) ?? 0;
  if (rawG) {
    console.log('\nRAW m26 vs m27:', rawG.get(26), rawG.get(27));
  }
  console.log('CLEANED m26 vs m27:', e26, e27);
  if (e26 < 4) throw new Error('cleaned m26 too empty');
  if (e27 < 4) throw new Error('cleaned m27 too empty');
  console.log('ok');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
