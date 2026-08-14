/**
 * HITL 미리보기 rest display-step 정리 검증.
 * Run: npx tsx _smoke/test_rest_display_osmd_preview.ts
 */
import { JSDOM } from 'jsdom';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay';

const dom = new JSDOM('');
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

function restDisplay(xml: string, pred: (note: Element, rest: Element) => boolean): Array<{ step: string | null; oct: string | null }> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: Array<{ step: string | null; oct: string | null }> = [];
  for (const note of doc.querySelectorAll('note')) {
    const rest = [...note.children].find((c) => c.localName === 'rest');
    if (!rest) continue;
    if (!pred(note, rest)) continue;
    const step = [...rest.children].find((c) => c.localName === 'display-step')?.textContent?.trim() ?? null;
    const oct = [...rest.children].find((c) => c.localName === 'display-octave')?.textContent?.trim() ?? null;
    out.push({ step, oct });
  }
  return out;
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="1">
      <attributes>
        <divisions>8</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><rest measure="yes"><display-step>D</display-step><display-octave>5</display-octave></rest><duration>32</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><rest><display-step>B</display-step><display-octave>4</display-octave></rest><duration>8</duration><type>quarter</type><voice>1</voice></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration><type>half</type><dot/><voice>1</voice></note>
    </measure>
    <measure number="4">
      <attributes>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
        <staves>2</staves>
      </attributes>
      <note>
        <rest><display-step>A</display-step><display-octave>3</display-octave></rest>
        <duration>4</duration><voice>5</voice><type>eighth</type><staff>2</staff>
      </note>
      <note>
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>4</duration><voice>5</voice><type>eighth</type><staff>2</staff>
      </note>
      <backup><duration>8</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>32</duration><voice>6</voice><type>whole</type><staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

const fixed = repairRestDisplayForOsmdPreview(xml);

const m1 = restDisplay(fixed, (_n, r) => r.getAttribute('measure') === 'yes');
if (m1.length !== 1 || m1[0].step != null) {
  console.error('measure rest should lose display-step', m1);
  process.exit(1);
}

const m2 = restDisplay(fixed, (n) => [...n.children].some((c) => c.localName === 'type' && c.textContent?.trim() === 'quarter'));
if (m2.length !== 1 || m2[0].step != null) {
  console.error('monophonic quarter rest should lose B4 hint', m2);
  process.exit(1);
}

const m4 = restDisplay(fixed, (n) => {
  const staff = [...n.children].find((c) => c.localName === 'staff')?.textContent?.trim();
  const type = [...n.children].find((c) => c.localName === 'type')?.textContent?.trim();
  return staff === '2' && type === 'eighth' && [...n.children].some((c) => c.localName === 'rest');
});
if (m4.length !== 1 || m4[0].step !== 'D' || m4[0].oct !== '3') {
  console.error('polyphonic PL eighth rest should pin to bass middle D3', m4);
  process.exit(1);
}

console.log('ok');
