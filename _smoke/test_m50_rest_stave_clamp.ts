/**
 * 50마디 PL(staff 2) voice 5 첫 4분 쉼표가 오선 밖으로 벗어나지 않고
 * 오선 안쪽(가운데줄~4줄 사이)으로 당겨져서 그려지는지 검증.
 *
 * npx tsx _smoke/test_m50_rest_stave_clamp.ts
 */
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h" style="width:1200px;height:1200px"></div></body></html>', {
  pretendToBeVisual: true,
});
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).DOMParser = dom.window.DOMParser;
(globalThis as any).XMLSerializer = dom.window.XMLSerializer;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).SVGElement = dom.window.SVGElement;
(globalThis as any).Element = dom.window.Element;
(globalThis as any).Node = dom.window.Node;
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get: () => 1200 });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get: () => 1200 });

const req = createRequire(import.meta.url);
const { OpenSheetMusicDisplay } = req('opensheetmusicdisplay');

async function main() {
  const { patchOsmdPolyphonicRestVfpitch, applyOsmdPolyphonicRestOffsets } = await import('../src/osmdRestPlacementFix');

  // Minimal m50 XML with F clef, voice 5 quarter rest, voice 6 half note
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P5"><part-name>P</part-name></score-part>
  </part-list>
  <part id="P5">
    <measure number="50">
      <attributes>
        <divisions>12</divisions>
        <key><fifths>-1</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <!-- Staff 1 notes -->
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>48</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>48</duration></backup>
      <!-- Staff 2 (PL) voice 5: quarter rest followed by notes -->
      <note>
        <rest><display-step>D</display-step><display-octave>3</display-octave></rest>
        <duration>12</duration>
        <voice>5</voice>
        <type>quarter</type>
        <staff>2</staff>
      </note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>12</duration><voice>5</voice><type>quarter</type><stem>up</stem><staff>2</staff></note>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>12</duration><voice>5</voice><type>quarter</type><stem>up</stem><staff>2</staff></note>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>12</duration><voice>5</voice><type>quarter</type><stem>up</stem><staff>2</staff></note>
      <backup><duration>48</duration></backup>
      <!-- Staff 2 (PL) voice 6: half note starting simultaneously -->
      <note>
        <pitch><step>F</step><octave>2</octave></pitch>
        <duration>24</duration>
        <voice>6</voice>
        <type>half</type>
        <stem>down</stem>
        <staff>2</staff>
      </note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>24</duration><voice>6</voice><type>half</type><stem>down</stem><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

  const host = document.getElementById('h')!;
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    drawTitle: false,
    backend: 'svg',
  });
  await osmd.load(xml);
  patchOsmdPolyphonicRestVfpitch(osmd);
  osmd.render();
  const shifted = applyOsmdPolyphonicRestOffsets(host, osmd);
  console.log("applyOsmdPolyphonicRestOffsets shifted:", shifted);

  // Find PL staffline and inspect rest bounding box
  let passed = false;
  const { forEachGraphicalMeasure } = await import('../src/osmdMeasureClick');

  forEachGraphicalMeasure(osmd, (gm, si) => {
    if (si !== 1) return; // Staff 2 (PL)
    const sl = (gm as any).ParentStaffLine ?? (gm as any).parentStaffLine;
    const topY = sl.PositionAndShape.AbsolutePosition.y * 10;
    const bottomY = topY + 40;

    for (const se of (gm.staffEntries ?? (gm as any).StaffEntries ?? [])) {
      for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? [])) {
        for (const gn of (gve.notes ?? gve.Notes ?? [])) {
          if (gn.sourceNote?.isRest?.()) {
            const svg = ((gn as any).getSVGGElement?.() as SVGGraphicsElement)?.closest('.vf-stavenote') as SVGGraphicsElement;
            if (!svg) continue;
            const paths = svg.querySelectorAll('path');
            const ys: number[] = [];
            paths.forEach((p: Element) => {
              const d = p.getAttribute('d') || '';
              const matches = d.matchAll(/[MLCSQTAZ]([-\d.]+)[, ]([-\d.]+)/g);
              for (const m of matches) ys.push(parseFloat(m[2]));
            });
            
            let ty = 0;
            let cur: Element | null = svg;
            while (cur) {
              const tr = cur.getAttribute?.('transform') ?? '';
              const tm = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(tr);
              if (tm) ty += parseFloat(tm[2] ?? '0');
              cur = cur.parentElement;
            }

            const minY = Math.min(...ys) + ty;
            const maxY = Math.max(...ys) + ty;
            console.log(`Staff 2 Stave [${topY.toFixed(1)}, ${bottomY.toFixed(1)}], Rest bounds: [${minY.toFixed(1)}, ${maxY.toFixed(1)}]`);

            // Must be inside stave line bounds with reasonable margin!
            if (minY >= topY - 1 && maxY <= bottomY + 2) {
              console.log("OK: 쉼표가 오선 안쪽에 안정적으로 위치함!");
              passed = true;
            } else {
              console.error(`FAIL: 쉼표가 오선 밖으로 벗어남! topY=${topY}, minY=${minY}`);
            }
          }
        }
      }
    }
  });

  if (!passed) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
