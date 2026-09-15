/**
 * Force system break between two measures; verify second-half crescendo opens.
 * Run: npx tsx _smoke/test_wedge_split_opening.ts
 */
import { JSDOM } from 'jsdom';
import { normalizeDynamicsAndWedgesForOsmdPreview } from '../shared/musicXmlDirectionPlacement';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:280px"></div></body></html>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0),
});
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get: () => 280 });
Object.defineProperty(dom.window.HTMLElement.prototype, 'getBoundingClientRect', {
  value: () => ({ width: 280, height: 400, top: 0, left: 0, right: 280, bottom: 400, x: 0, y: 0, toJSON() {} }),
});

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="60">
      <attributes><divisions>8</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><type>eighth</type></note>
      <direction placement="above"><direction-type><wedge type="crescendo" number="1" spread="0"/></direction-type><staff>1</staff></direction>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note>
    </measure>
    <measure number="61">
      <print new-system="yes"/>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note>
      <note><chord/><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note>
      <direction placement="above"><direction-type><wedge type="stop" number="1" spread="15"/></direction-type><staff>1</staff></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>eighth</type></note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  // Ensure OSMD patch present
  const fs = await import('fs');
  const minjs = fs.readFileSync('node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js', 'utf8');
  if (!minjs.includes('_n=Math.max(n,Math.min(_len*.5,14))')) {
    throw new Error('second-half crescendo length-scale patch missing — run node scripts/patch_osmd_navigation_labels.mjs');
  }

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    useXMLMeasureNumbers: true,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  (osmd.EngravingRules as any).WedgeOpeningLength = 5;
  (osmd.EngravingRules as any).WedgeMeasureBeginOpeningLength = 3.5;
  (osmd.EngravingRules as any).WedgeMeasureEndOpeningLength = 3.5;
  await osmd.load(normalizeDynamicsAndWedgesForOsmdPreview(xml));
  osmd.render();

  const wedges: { len: number; openGap: number; angleTan: number; split?: boolean }[] = [];
  for (const page of (osmd as any).GraphicSheet.MusicPages || []) {
    for (const sys of page.MusicSystems || []) {
      for (const sl of sys.StaffLines || []) {
        for (const ex of sl.AbstractExpressions || []) {
          const lines = ex.lines || [];
          if (lines.length < 2) continue;
          const a = lines[0];
          const b = lines[1];
          const len = Math.abs((a.End?.x ?? 0) - (a.Start?.x ?? 0));
          const openGap = Math.max(
            Math.abs((a.End?.y ?? 0) - (b.End?.y ?? 0)),
            Math.abs((a.Start?.y ?? 0) - (b.Start?.y ?? 0)),
          );
          wedges.push({
            len: +len.toFixed(2),
            openGap: +openGap.toFixed(2),
            angleTan: +(openGap / 2 / Math.max(len, 0.01)).toFixed(3),
            split: !!ex.isSplittedPart,
          });
        }
      }
    }
  }
  console.log(JSON.stringify(wedges, null, 2));
  // At least one segment should open meaningfully (not ~default 3.5 on a long span)
  const opened = wedges.some((w) => w.openGap >= 6 || w.angleTan >= 0.2);
  if (!opened) {
    throw new Error('split/cross-measure crescendo segments still too flat: ' + JSON.stringify(wedges));
  }
  console.log('ok wedge split opening');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
