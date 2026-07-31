import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { parseMusicXmlDocument } from './shared/musicXmlParse.ts';
import { buildOsmdPreviewXml } from './src/AudiverisInspectPanel.tsx';

const dom = new JSDOM();
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.HTMLDivElement = dom.window.HTMLDivElement;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;

const xml = readFileSync('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml', 'utf8');
const doc = parseMusicXmlDocument(xml);
const scoreParts = [...doc.querySelectorAll('score-part')].map(p => ({
  id: p.getAttribute('id')!,
  label: p.querySelector('part-name')?.textContent || ''
}));

const fullScoreXml = buildOsmdPreviewXml(xml, scoreParts, null, { verbatim: false });
const div = document.createElement('div');
const osmd = new OpenSheetMusicDisplay(div, { drawingParameters: 'compacttight' });
osmd.setLogLevel('debug');
osmd.load(fullScoreXml).then(() => {
  osmd.render();
  console.log('RENDER DONE');
}).catch(console.error);
