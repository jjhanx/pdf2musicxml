/**
 * PL direction on P5 m17 — full-score preview must not leave staff=2 on direction (P2 오인).
 * Run: npx tsx _smoke/test_preview_pl_dir.ts
 */
import fs from 'node:fs';
import { buildOsmdPreviewXml } from '../src/AudiverisInspectPanel.tsx';

const raw = fs.readFileSync('omr-work-20e53bc4.zip');
// use review from zip via python export if needed — minimal inline XML from inspect
const minimal = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
<part-list>
<score-part id="P1"><part-name>P1</part-name></score-part>
<score-part id="P2"><part-name>P2</part-name></score-part>
<score-part id="P5"><part-name>Piano</part-name></score-part>
</part-list>
<part id="P1"><measure number="17"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
</measure></part>
<part id="P2"><measure number="17"><attributes><divisions>4</divisions></attributes>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
</measure></part>
<part id="P5"><measure number="17">
<attributes><divisions>4</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><staff>1</staff></note>
<backup><duration>4</duration></backup>
<direction><direction-type><words>PL test</words></direction-type><voice>5</voice></direction>
<note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part>
</score-partwise>`;

const scoreParts = [
  { id: 'P1', suggestedLabel: 'P1', displayLabel: 'P1' },
  { id: 'P2', suggestedLabel: 'P2', displayLabel: 'P2' },
  { id: 'P5', suggestedLabel: 'P', displayLabel: 'P' },
];

const full = buildOsmdPreviewXml(minimal, scoreParts, null);
const pl = buildOsmdPreviewXml(minimal, scoreParts, { label: 'PL', partId: 'P5', staffWithinPart: 2 });

function check(xml: string, label: string) {
  const p2m = xml.match(/<part id="P2"[\s\S]*?<\/part>/);
  const p2dir = p2m?.[0].includes('<direction') ?? false;
  const staff2OnDir = /<direction[^>]*>[\s\S]*?<staff>2<\/staff>/.test(xml);
  const plPart = xml.includes('id="P5__PL"') || (xml.includes('id="P5"') && label.includes('PL'));
  const plDir = xml.match(/id="P5__PL"[\s\S]*?<\/part>/)?.[0] ?? xml;
  const plWords = plDir.includes('PL test');
  console.log(`${label}: P2 has direction=${p2dir} any direction staff=2=${staff2OnDir} PL part=${plPart} PL words=${plWords}`);
  if (p2dir || staff2OnDir) process.exitCode = 1;
}

check(full, 'full score split');
check(pl, 'PL filter');
console.log('preview pl dir ok');
