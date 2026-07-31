/**
 * Repro: invalid <tocoda/> vs proper To Coda — OSMD layout for m36 notes 2/3.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

execSync(
  `python -c "import io,zipfile,sys; sys.path.insert(0,'scripts'); from omr_hitl_lib import apply_fix; import xml.etree.ElementTree as ET; from pathlib import Path; z=zipfile.ZipFile('omr-work-23ddc764.zip'); d=z.read('review.mxl'); i=zipfile.ZipFile(io.BytesIO(d)); xml=i.read([n for n in i.namelist() if n.endswith('.xml') and 'META' not in n.upper()][0]); root=ET.fromstring(xml); 
for a,b in [(0,1),(1,2),(2,3)]: apply_fix(root,'',{'kind':'setPlayOrder','partId':'P1','measureMxl':'36','noteIndex':a,'playOrder':b});
apply_fix(root,'',{'kind':'insertDirection','partId':'P1','measureMxl':'36','afterNoteIndex':-1,'directionType':'tocoda','staff':1,'placement':'above'});
# keep only P1 m35-37 for speed
for part in list(root.findall('{http://www.musicxml.org/ns/partwise}part')+root.findall('part')):
  if part.get('id')!='P1': root.remove(part)
for sp in list(root.findall('.//{http://www.musicxml.org/ns/partwise}score-part')+root.findall('.//score-part')):
  if sp.get('id')!='P1': 
    try: list(root.iter()) 
    except: pass
Path('_smoke/_tmp_23dd_tocoda.xml').write_text(ET.tostring(root, encoding='unicode'), encoding='utf8')"`,
  { stdio: 'inherit', shell: true },
);

async function main() {
  let xml = fs.readFileSync('_smoke/_tmp_23dd_tocoda.xml', 'utf8');
  // strip other parts from score-part-list roughly
  const host = document.getElementById('host')!;
  const osmd = new OSMD!(host, { autoResize: false, backend: 'svg', drawMeasureNumbers: true });
  try {
    await (osmd as { load: (x: string) => Promise<void> }).load(xml);
    (osmd as { render: () => void }).render();
    console.log('OSMD load+render OK with current tocoda');
  } catch (e) {
    console.error('OSMD FAIL', e);
  }
}
main();
