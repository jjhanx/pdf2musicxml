/**
 * Whole-note + trailing mid G: OSMD must keep note in F clef (Y≈baseline) and show vfClefBefore.
 * Run: npx tsx _smoke/test_whole_trailing_g_clef_osmd.ts
 */
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { anchorTrailingMidClefsForOsmdPreview } from '../shared/musicXmlMidClefOsmdAnchor';

const require = createRequire(import.meta.url);
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h" style="width:1000px;height:400px"></div></body></html>', {
  pretendToBeVisual: true,
});
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  SVGElement: dom.window.SVGElement,
  XMLHttpRequest: class {
    open() {}
    send() {}
    setRequestHeader() {}
    addEventListener() {}
  },
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

const BASE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>4</duration><type>whole</type><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

const WITH_G = BASE.replace(
  '</note>\n    </measure>',
  '</note>\n      <attributes><clef><sign>G</sign><line>2</line></clef></attributes>\n    </measure>',
);

function soundingYs(osmd: InstanceType<typeof OpenSheetMusicDisplay>): number[] {
  const ys: number[] = [];
  for (const row of osmd.GraphicSheet.MeasureList ?? []) {
    for (const gm of row ?? []) {
      if (!gm) continue;
      for (const se of gm.staffEntries ?? []) {
        for (const gve of se.graphicalVoiceEntries ?? []) {
          for (const gn of gve.notes ?? []) {
            if (gn.sourceNote?.isRest?.()) continue;
            const y = gn.PositionAndShape?.AbsolutePosition?.y;
            if (typeof y === 'number') ys.push(y);
          }
        }
      }
    }
  }
  return ys;
}

function vfClefCount(osmd: InstanceType<typeof OpenSheetMusicDisplay>): number {
  let n = 0;
  for (const row of osmd.GraphicSheet.MeasureList ?? []) {
    for (const gm of row ?? []) {
      if (!gm) continue;
      for (const se of gm.staffEntries ?? []) if (se.vfClefBefore) n += 1;
    }
  }
  return n;
}

async function run(label: string, xml: string) {
  const host = document.getElementById('h')!;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawTitle: false });
  await osmd.load(xml);
  osmd.render();
  const ys = soundingYs(osmd);
  const vf = vfClefCount(osmd);
  console.log(label, 'vf=', vf, 'ys=', ys);
  return { ys, vf };
}

const base = await run('base-F-only', BASE);
const rawG = await run('raw-trailing-G', WITH_G);
const anchoredXml = anchorTrailingMidClefsForOsmdPreview(WITH_G);
console.log('anchored has invisible rest', /print-object="no"/.test(anchoredXml));
if (!/<divisions>\s*8\s*<\/divisions>/.test(anchoredXml)) {
  throw new Error('expected divisions refined (×8) for whole-note peel');
}
if (!/<duration>\s*31\s*<\/duration>/.test(anchoredXml)) {
  throw new Error('expected peeled duration 31 after ×8 scale');
}
const doc = new DOMParser().parseFromString(anchoredXml, 'application/xml');
const tags = [...doc.querySelector('measure')!.children].map((c) => {
  const t = (c.localName || '').toLowerCase();
  if (t === 'note') return c.querySelector('rest') ? 'rest' : 'note';
  if (t === 'attributes') return 'attrs:' + (c.querySelector('sign')?.textContent ?? '?');
  return t;
});
console.log('anchored order', tags);
const anchored = await run('anchored-trailing-G', anchoredXml);

const dyRaw = Math.abs((rawG.ys[0] ?? 0) - (base.ys[0] ?? 0));
const dyAnc = Math.abs((anchored.ys[0] ?? 0) - (base.ys[0] ?? 0));
console.log('dy raw vs base', dyRaw, 'dy anchored vs base', dyAnc);

if (rawG.vf < 1) console.log('expected: raw trailing G has no vfClefBefore');
if (anchored.vf < 1) throw new Error('anchored should have vfClefBefore');
if (dyAnc > 2) throw new Error(`anchored note still shifted by ${dyAnc}`);
if (tags.indexOf('attrs:G') < tags.indexOf('note') && tags.includes('note')) {
  // G must not be before the sounding note
  const gi = tags.indexOf('attrs:G');
  const ni = tags.indexOf('note');
  if (gi >= 0 && ni >= 0 && gi < ni) throw new Error('G before note');
}
console.log('ok whole trailing G');
