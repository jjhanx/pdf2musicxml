/**
 * OSMD: tempo on m1 must not create implicit/empty first measure or drop notes.
 * Run: node _smoke/test_osmd_tempo_m1.mjs
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const OSMD = require('opensheetmusicdisplay');

function dumpSheet(osmd, label) {
  const sheet = osmd.Sheet;
  const measures = sheet.SourceMeasures || [];
  console.log(`\n=== ${label} ===`);
  console.log('sourceMeasures:', measures.length);
  for (let i = 0; i < Math.min(4, measures.length); i++) {
    const m = measures[i];
    let notes = 0;
    try {
      for (const staff of m.VerticalSourceStaffEntryContainers || []) {
        for (const sse of staff.StaffEntries || []) {
          for (const ve of sse.VoiceEntries || []) {
            notes += (ve.Notes || []).length;
          }
        }
      }
    } catch {
      /* ignore */
    }
    console.log(
      `  idx=${i} number=${m.MeasureNumber} implicit=${m.ImplicitMeasure} duration=${m.Duration} notes~${notes} tempo=${m.TempoInBPM}`,
    );
  }
  return measures;
}

async function loadOsmd(xml) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="osmd"></div></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;
  global.HTMLElement = dom.window.HTMLElement;
  global.SVGElement = dom.window.SVGElement;
  global.Node = dom.window.Node;
  global.DOMParser = dom.window.DOMParser;
  global.XMLSerializer = dom.window.XMLSerializer;
  const host = document.getElementById('osmd');
  host.style.width = '1200px';
  const osmd = new OSMD.OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
  });
  await osmd.load(xml);
  return osmd;
}

const MINIMAL = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

const WITH_TEMPO_AFTER_ATTR = MINIMAL.replace(
  '</attributes>',
  `</attributes>
      <direction placement="above">
        <direction-type>
          <metronome parentheses="no">
            <beat-unit>quarter</beat-unit>
            <per-minute>72</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="72"/>
      </direction>`,
);

const WITH_TEMPO_BEFORE_ATTR = MINIMAL.replace(
  '<attributes>',
  `<direction placement="above">
        <direction-type>
          <metronome parentheses="no">
            <beat-unit>quarter</beat-unit>
            <per-minute>72</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="72"/>
      </direction>
      <attributes>`,
);

const WITH_TEMPO_AFTER_NOTE = MINIMAL.replace(
  '</note>',
  `</note>
      <direction placement="above">
        <direction-type>
          <metronome parentheses="no">
            <beat-unit>quarter</beat-unit>
            <per-minute>72</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="72"/>
      </direction>`,
);

const SOUND_ONLY_AFTER_ATTR = MINIMAL.replace(
  '</attributes>',
  `</attributes>
      <direction>
        <sound tempo="72"/>
      </direction>`,
);

const TWO_PART_HITL = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>S</part-name></score-part>
    <score-part id="P2"><part-name>A</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction placement="above">
        <direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>72</per-minute></metronome></direction-type>
        <sound tempo="72"/>
      </direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <direction placement="above"><sound tempo="72"/></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

const TWO_PART_PRINT_NO = TWO_PART_HITL.replace(
  '<direction placement="above"><sound tempo="72"/></direction>',
  `<direction placement="above" print-object="no">
        <direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>72</per-minute></metronome></direction-type>
        <sound tempo="72"/>
      </direction>`,
);

const TWO_PART_P2_AFTER_NOTE = TWO_PART_HITL.replace(
  `<direction placement="above"><sound tempo="72"/></direction>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`,
  `<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      <direction placement="above"><sound tempo="72"/></direction>`,
);

async function main() {
  for (const [label, xml] of [
    ['no tempo', MINIMAL],
    ['tempo AFTER attributes (current HITL)', WITH_TEMPO_AFTER_ATTR],
    ['tempo BEFORE attributes (old bug)', WITH_TEMPO_BEFORE_ATTR],
    ['tempo AFTER first note', WITH_TEMPO_AFTER_NOTE],
    ['sound-only AFTER attributes', SOUND_ONLY_AFTER_ATTR],
    ['2-part HITL (P1 metro, P2 sound-only start)', TWO_PART_HITL],
    ['2-part P2 metronome print-object=no', TWO_PART_PRINT_NO],
    ['2-part P2 sound-only AFTER note', TWO_PART_P2_AFTER_NOTE],
  ]) {
    try {
      const osmd = await loadOsmd(xml);
      dumpSheet(osmd, label);
    } catch (e) {
      console.log(`\n=== ${label} === FAIL`, e instanceof Error ? e.message : e);
    }
  }

  const osmd = await loadOsmd(TWO_PART_PRINT_NO);
  const m0 = osmd.Sheet.SourceMeasures[0];
  let notes = 0;
  for (const c of m0.VerticalSourceStaffEntryContainers || []) {
    for (const se of c.StaffEntries || []) {
      if (!se) continue;
      for (const ve of se.VoiceEntries || []) notes += (ve.Notes || []).length;
    }
  }
  if (m0.ImplicitMeasure || m0.MeasureNumber !== 1 || notes < 2) {
    console.error('FAIL: hidden-metronome 2-part m1', {
      implicit: m0.ImplicitMeasure,
      number: m0.MeasureNumber,
      notes,
    });
    process.exit(1);
  }
  console.log('OK: OSMD keeps both parts notes with hidden metronome');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
