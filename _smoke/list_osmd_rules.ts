import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
const OSMD = (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay
  ?? (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, { document: dom.window.document, window: dom.window, Node: dom.window.Node, Element: dom.window.Element, requestAnimationFrame: (cb: FrameRequestCallback)=>{setTimeout(()=>cb(0),0);return 0;} });
const osmd = new OSMD!(document.getElementById('h')!, { autoResize: false, backend: 'svg' });
const keys = Object.keys((osmd as { EngravingRules: Record<string, unknown> }).EngravingRules)
  .filter((k) => /voice|Voice|spacing|Spacing|Distance|xml|Xml|default|Default|align|Align|column|Column/i.test(k));
console.log(keys.join('\n'));
