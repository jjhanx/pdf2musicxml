/**
 * Mid F matching header must be kept when trailing G follows — otherwise OSMD
 * applies G to notes before the change.
 * Run: npx tsx _smoke/test_courtesy_keep_mid_before_trailing_change.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { removeRedundantCourtesyClefsForOsmd } from '../shared/musicXmlCourtesyClef.ts';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const XML = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="52">
      <attributes>
        <divisions>4</divisions>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>E</step><octave>1</octave></pitch><duration>16</duration><type>whole</type><voice>5</voice><staff>2</staff></note>
      <attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
    </measure>
  </part>
</score-partwise>`;

const out = removeRedundantCourtesyClefsForOsmd(XML);
const doc = new DOMParser().parseFromString(out, 'application/xml');
const m = doc.querySelector('measure')!;
const order: string[] = [];
for (const c of [...m.children]) {
  const tag = c.localName;
  if (tag === 'note') {
    const st = c.querySelector('staff')?.textContent ?? '1';
    const step = c.querySelector('step')?.textContent ?? '';
    order.push(`note:${step}s${st}`);
  } else if (tag === 'attributes') {
    for (const cl of [...c.querySelectorAll('clef')]) {
      order.push(`clef:${cl.querySelector('sign')?.textContent}n${cl.getAttribute('number')}`);
    }
  } else if (tag === 'backup') order.push('backup');
}

assert.ok(order.includes('clef:Fn2'), `mid F kept: ${order.join(' ')}`);
assert.ok(order.includes('clef:Gn2'), `trailing G kept: ${order.join(' ')}`);
const backup = order.indexOf('backup');
const midF = order.indexOf('clef:Fn2', backup);
const note = order.indexOf('note:Es2');
const g = order.indexOf('clef:Gn2');
assert.ok(midF > backup && midF < note && note < g, order.join(' '));

// plain duplicate trailing same as active still stripped
const plain = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <attributes><clef><sign>G</sign><line>2</line></clef></attributes>
    </measure>
  </part>
</score-partwise>`;
const plainOut = removeRedundantCourtesyClefsForOsmd(plain);
const plainDoc = new DOMParser().parseFromString(plainOut, 'application/xml');
const clefs = [...plainDoc.querySelectorAll('clef')];
assert.equal(clefs.length, 1, 'duplicate trailing G still stripped');

console.log('courtesy keep mid before trailing change ok');
