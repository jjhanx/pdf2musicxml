import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import osmdLib from 'opensheetmusicdisplay';
const OpenSheetMusicDisplay = (osmdLib as any).OpenSheetMusicDisplay;

const dom = new JSDOM('<div id=\'host\' style=\'width:1400px;height:8000px\'></div>');
const g = globalThis as any;
g.document = dom.window.document;
g.window = dom.window;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLCanvasElement = dom.window.HTMLCanvasElement;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.SVGElement = dom.window.SVGElement;
g.requestAnimationFrame = (cb: any) => { setTimeout(() => cb(0), 0); return 0; };

const xml = readFileSync('C:/Users/jjhan/.gemini/antigravity-ide/brain/0009d072-c932-4a3d-8371-4463bfeebbbc/scratch/omr-work-0ea5ea52/audiveris_raw_mxl/clean_score_only.xml', 'utf8');
const cleanedXml = repairTimelineForOsmdPreview(xml);

const osmd = new OpenSheetMusicDisplay(g.document.getElementById('host'), { backend: 'svg', drawMeasureNumbers: false, autoResize: false });
osmd.setLogLevel('debug');
osmd.load(cleanedXml).then(() => {
    osmd.render();
    const sheet = osmd.GraphicSheet as any;
    const measures = sheet.MeasureList.filter((m: any) => m[0] && m[0].MeasureNumber === 26);
    console.log('M26 parts:', measures.length);
    if(measures.length > 0) {
        console.log('M26 length:', measures[0].length);
        measures[0].forEach((m: any, i: number) => {
            if (m) console.log('Staff', i, 'rendered');
            else console.log('Staff', i, 'MISSING');
        });
    }
}).catch(e => console.error('OSMD Error', e));
