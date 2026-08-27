/**
 * OSMD must create in-staff mid clef (vfClefBefore / ClefNote) for mid-measure G.
 * Run: npx tsx _smoke/test_mid_clef_osmd_renders.ts
 */
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h" style="width:900px;height:400px"></div></body></html>', {
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

const XML = `<?xml version="1.0"?>
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
      <attributes><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  const host = document.getElementById('h')!;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawTitle: false });
  await osmd.load(XML);
  osmd.render();

  // Inspect graphical model for in-staff clefs
  const sheet = osmd.GraphicSheet;
  let inStaff = 0;
  let staveClefs = 0;
  const dump: string[] = [];
  for (const measure of sheet.MeasureList?.flat?.() ?? sheet.MeasureList ?? []) {
    if (!measure) continue;
    const staffEntries = measure.staffEntries ?? measure.staffEntries;
    // walk sources
  }
  // SVG paths
  const svg = host.querySelector('svg');
  const classes = [...(svg?.querySelectorAll('[class]') ?? [])]
    .map((e) => e.getAttribute('class') || '')
    .filter((c) => /clef/i.test(c));
  console.log('svg clef-related classes', [...new Set(classes)]);

  // OSMD internal: SourceMeasure Instructions
  const src = osmd.Sheet?.SourceMeasures?.[0]?.SourceMeasures?.[0];
  // try multiple API shapes
  const measures = osmd.Sheet?.SourceMeasures?.[0]?.SourceMeasures
    ?? osmd.Sheet?.MusicPages?.[0]?.MusicSystems
    ?? [];
  console.log('sheet keys', Object.keys(osmd.Sheet || {}));

  const part = osmd.Sheet?.SourceMeasures?.[0];
  console.log('part keys', part && Object.keys(part));

  // GraphicalMeasure staffEntries modifiers
  try {
    const gmeasures = osmd.GraphicSheet.MeasureList;
    for (let i = 0; i < gmeasures.length; i++) {
      for (const gm of gmeasures[i] ?? []) {
        if (!gm) continue;
        for (const se of gm.staffEntries ?? []) {
          const mods = se.graphicalVoiceEntries?.flatMap((gve: any) =>
            (gve.notes ?? []).flatMap((n: any) => n.veModifs ?? n.modifs ?? n.modifiers ?? []),
          ) ?? [];
          for (const m of mods) {
            dump.push(`mod:${m?.constructor?.name}`);
            if (/clef/i.test(m?.constructor?.name || '')) inStaff += 1;
          }
          if (se.vfClefBefore) {
            inStaff += 1;
            dump.push('vfClefBefore');
          }
          if ((se as any).clefsBefore?.length) {
            inStaff += (se as any).clefsBefore.length;
            dump.push('clefsBefore');
          }
        }
        const abs = (gm as any).staffLine?.staffLines;
        void abs;
      }
    }
  } catch (e) {
    console.log('graphic walk err', e);
  }

  // Fallback: count .vf-clef glyphs — begin clef + mid should be >= 2
  const vfClefs = svg?.querySelectorAll('.vf-clef')?.length ?? 0;
  staveClefs = vfClefs;
  console.log({ inStaff, staveClefs, dump: dump.slice(0, 20) });

  // Also try with staves injected mid (what normalizeAttributes does)
  const XML_STAVES = XML.replace(
    '<attributes><clef><sign>G</sign><line>2</line></clef></attributes>',
    '<attributes><staves>1</staves><clef number="1"><sign>G</sign><line>2</line></clef></attributes>',
  );
  host.innerHTML = '';
  const osmd2 = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg', drawTitle: false });
  await osmd2.load(XML_STAVES);
  osmd2.render();
  const vf2 = host.querySelectorAll('.vf-clef').length;
  console.log('with mid staves vf-clef count', vf2);

  // Clean mid (no number, no staves) vs after previous note — control
  if (staveClefs < 2 && inStaff < 1) {
    // Probe SourceMeasure for MidMeasureInstruction / ClefInstruction
    const sm = (osmd.Sheet as any).SourceMeasures?.[0]?.SourceMeasures?.[0]
      ?? (osmd.Sheet as any).MusicSheet?.SourceMeasures?.[0]?.SourceMeasures?.[0];
    console.log('trying FirstInstructions / Instructions');
    const allSrcMeasures = [];
    const instruments = (osmd.Sheet as any).Instruments ?? (osmd.Sheet as any).SourceMeasures ?? [];
    for (const inst of instruments) {
      for (const m of inst.SourceMeasures ?? []) allSrcMeasures.push(m);
    }
    console.log('src measure count', allSrcMeasures.length);
    for (const m of allSrcMeasures) {
      const fi = m.FirstInstructionsStaffEntries ?? m.firstInstructionsStaffEntries;
      const li = m.LastInstructionsStaffEntries;
      console.log('FirstInstructions', fi && Object.keys(fi));
      // staffEntries with AbsoluteTimestamp
      for (const se of m.VerticalStaffEntryContainers ?? m.staffEntries ?? []) {
        const entries = se.StaffEntries ?? se.staffEntries ?? [se];
        for (const e of entries) {
          const instructions = e?.Instructions ?? e?.instructions ?? [];
          for (const ins of instructions) {
            console.log('ins', ins?.constructor?.name, ins);
          }
        }
      }
    }
    throw new Error(`OSMD did not draw mid clef: vf-clef=${staveClefs} inStaff=${inStaff}`);
  }
  console.log('mid_clef_osmd_renders ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
