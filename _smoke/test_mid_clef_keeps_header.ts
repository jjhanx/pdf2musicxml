/**
 * Mid F clef must not steal the measure: keep/inject header G so notes before F stay treble.
 * Run: npx tsx _smoke/test_mid_clef_keeps_header.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { removeRedundantCourtesyClefsForOsmd } from '../shared/musicXmlCourtesyClef.ts';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const TWO_MEASURES = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const MID_ONLY = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
      <attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

function measure2Order(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const measures = [...doc.querySelectorAll('measure')];
  const m2 = measures[1]!;
  const out: string[] = [];
  let seenNote = false;
  for (const el of [...m2.children]) {
    const tag = (el.localName || el.tagName).toLowerCase();
    if (tag === 'note') {
      seenNote = true;
      const step = el.querySelector('step')?.textContent ?? '?';
      out.push(`note:${step}`);
    } else if (tag === 'attributes') {
      const signs = [...el.querySelectorAll('sign')].map((s) => s.textContent);
      if (signs.length) out.push(`${seenNote ? 'mid' : 'head'}:${signs.join(',')}`);
    }
  }
  return out;
}

{
  const out = removeRedundantCourtesyClefsForOsmd(TWO_MEASURES);
  const order = measure2Order(out);
  assert.ok(order[0] === 'head:G', `keep header G when mid F: ${order}`);
  assert.ok(order.includes('mid:F'), `mid F stays: ${order}`);
  const midAt = order.indexOf('mid:F');
  assert.ok(midAt > 1 && order[midAt - 1]?.startsWith('note:'), `F after notes: ${order}`);
}

{
  const out = removeRedundantCourtesyClefsForOsmd(MID_ONLY);
  const order = measure2Order(out);
  assert.ok(order[0] === 'head:G', `inject header G before mid F: ${order}`);
  assert.ok(order.includes('mid:F'), order);
}

// courtesy-only still stripped
{
  const plain = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <attributes><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;
  const out = removeRedundantCourtesyClefsForOsmd(plain);
  const signs = [...out.matchAll(/<sign>([^<]*)<\/sign>/g)].map((m) => m[1]);
  assert.deepEqual(signs, ['G'], `plain courtesy still stripped: ${signs}`);
}

console.log('ok mid_clef_keeps_header');
