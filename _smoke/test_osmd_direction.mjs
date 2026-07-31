/**
 * OSMD render test — PL direction staff=2 vs voice-only.
 * Run: node _smoke/test_osmd_direction.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const OSMD = require('opensheetmusicdisplay');

function buildScore(dirXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>P1</part-name></score-part>
    <score-part id="P2"><part-name>P2</part-name></score-part>
    <score-part id="P5"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
  </measure></part>
  <part id="P2"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
  </measure></part>
  <part id="P5"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef>
      <clef number="2"><sign>F</sign><line>4</line></clef>
    </attributes>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff><voice>1</voice></note>
    <backup><duration>4</duration></backup>
    ${dirXml}
    <note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
  </measure></part>
</score-partwise>`;
}

async function renderAndDump(label, xml) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="osmd"></div></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;
  global.HTMLElement = dom.window.HTMLElement;
  global.SVGElement = dom.window.SVGElement;
  global.Node = dom.window.Node;
  global.DOMParser = dom.window.DOMParser;
  global.XMLSerializer = dom.window.XMLSerializer;

  const host = document.getElementById('osmd');
  const osmd = new OSMD.OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
  await osmd.load(xml);
  osmd.render();

  const texts = [...host.querySelectorAll('text,tspan')]
    .map((t) => ({
      y: parseFloat(t.getAttribute('y') || '0'),
      text: t.textContent?.trim(),
    }))
    .filter((t) => t.text && /poco|PL|mosso/i.test(t.text));

  const staffLines = [...host.querySelectorAll('line')]
    .map((l) => parseFloat(l.getAttribute('y1') || l.getAttribute('y') || '0'))
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b);

  console.log(`\n=== ${label} ===`);
  console.log('direction texts:', texts);
  console.log('staff line y sample (first 8):', staffLines.slice(0, 8));
}

const cases = {
  staff2_after_backup: `<direction><direction-type><words>poco piu mosso</words></direction-type><staff>2</staff></direction>`,
  voice5_after_backup: `<direction><direction-type><words>poco piu mosso</words></direction-type><voice>5</voice></direction>`,
  voice5_measure_start: `<direction><direction-type><words>poco piu mosso</words></direction-type><voice>5</voice></direction>`,
  staff2_measure_start: `<direction placement="below"><direction-type><words>poco piu mosso</words></direction-type><staff>2</staff></direction>`,
};

for (const [name, dir] of Object.entries(cases)) {
  const xml =
    name.includes('measure_start')
      ? buildScore('').replace(
          '<note><pitch><step>G</step><octave>4</octave>',
          `${dir}\n    <note><pitch><step>G</step><octave>4</octave>`,
        )
      : buildScore(dir);
  try {
    await renderAndDump(name, xml);
  } catch (e) {
    console.log(`\n=== ${name} FAILED ===`, e.message);
  }
}
