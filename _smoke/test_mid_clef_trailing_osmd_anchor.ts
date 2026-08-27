/**
 * Trailing mid clef (after last note) must become OSMD vfClefBefore via invisible rest anchor.
 * Run: npx tsx _smoke/test_mid_clef_trailing_osmd_anchor.ts
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
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
});

const TRAILING = `<?xml version="1.0"?>
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
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
    </measure>
  </part>
</score-partwise>`;

function countVfClefBefore(osmd: InstanceType<typeof OpenSheetMusicDisplay>): number {
  let n = 0;
  for (const row of osmd.GraphicSheet.MeasureList ?? []) {
    for (const gm of row ?? []) {
      if (!gm) continue;
      for (const se of gm.staffEntries ?? []) {
        if (se.vfClefBefore) n += 1;
      }
    }
  }
  return n;
}

async function probe(label: string, xml: string) {
  const host = document.getElementById('h')!;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawTitle: false });
  await osmd.load(xml);
  osmd.render();
  const n = countVfClefBefore(osmd);
  console.log(label, 'vfClefBefore=', n);
  return n;
}

/** Mid G before backup; notes after backup are another layer — still needs anchor. */
const BEFORE_BACKUP = `<?xml version="1.0"?>
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
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>half</type><voice>1</voice></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>2</duration><type>half</type><voice>1</voice></note>
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <backup><duration>4</duration></backup>
      <note><pitch><step>A</step><octave>2</octave></pitch><duration>4</duration><type>whole</type><voice>2</voice></note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  const before = await probe('trailing-raw', TRAILING);
  const anchored = anchorTrailingMidClefsForOsmdPreview(TRAILING);
  if (!anchored.includes('print-object="no"')) {
    throw new Error('expected invisible rest anchor in XML');
  }
  console.log('anchored snippet', anchored.match(/<attributes>[\s\S]*?<\/note>/)?.[0]?.slice(0, 280));
  const after = await probe('trailing-anchored', anchored);
  if (before >= 1) {
    console.log('note: raw trailing already had vfClefBefore (unexpected)');
  }
  if (after < 1) throw new Error('anchored trailing mid clef still not drawn by OSMD');

  const beforeBu = await probe('before-backup-raw', BEFORE_BACKUP);
  const anchoredBu = anchorTrailingMidClefsForOsmdPreview(BEFORE_BACKUP);
  if (!/<attributes>[\s\S]*?print-object="no"[\s\S]*?<backup/i.test(anchoredBu)) {
    throw new Error('expected invisible rest between mid clef and backup');
  }
  const afterBu = await probe('before-backup-anchored', anchoredBu);
  if (beforeBu >= 1) {
    console.log('note: raw before-backup already had vfClefBefore (unexpected)');
  }
  if (afterBu < 1) throw new Error('anchored mid clef before backup still not drawn by OSMD');
  console.log('mid_clef_trailing_osmd_anchor ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
