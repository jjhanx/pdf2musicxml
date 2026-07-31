const fs = require('fs');
const { execSync } = require('child_process');
const { JSDOM } = require('jsdom');
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

execSync(
  'python scripts/mxl_to_musicxml_file.py "청산에 살리라 F/_inspect_0ea5/review.mxl" "_smoke/_cheongsan_from_mxl.xml"',
  { stdio: 'inherit' },
);

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
for (const k of ['window', 'document', 'navigator', 'DOMParser', 'XMLSerializer', 'Node']) {
  global[k] = dom.window[k];
}
global.requestAnimationFrame = (cb) => {
  setTimeout(() => cb(0), 0);
  return 0;
};

async function main() {
  const host = document.getElementById('host');
  host.style.width = '1400px';
  host.style.height = '12000px';
  const xml = fs.readFileSync('_smoke/_cheongsan_from_mxl.xml', 'utf8');
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawMeasureNumbers: false });
  await osmd.load(xml);
  osmd.zoom = 0.3;
  await osmd.render();
  const ms = osmd.GraphicSheet.MeasureList;
  for (const n of [24, 25, 26, 27, 28]) {
    const m = ms.filter((x) => Number(x.MeasureNumber ?? x.measureNumber) === n);
    let e = 0;
    for (const x of m) e += (x.staffEntries || x.VerticalSourceStaffEntryContainers || []).length;
    console.log('m' + n, 'staves', m.length, 'entries', e);
  }
}

main().catch((e) => {
  console.error('FAIL', e.message || e);
  process.exit(1);
});
