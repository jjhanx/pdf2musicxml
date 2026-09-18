/** Smoke: fixCrossStaffBackupDurationsInXml turns backup 16 → staff1 length 48. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fixCrossStaffBackupDurationsInXml } from '../shared/musicXmlStaffPreview.ts';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="8">
      <attributes><staves>2</staves></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><staff>1</staff></note>
      <note><chord/><pitch><step>C</step><octave>6</octave></pitch><duration>24</duration><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><staff>1</staff></note>
      <note><chord/><pitch><step>C</step><octave>6</octave></pitch><duration>12</duration><staff>1</staff></note>
      <note><rest/><duration>12</duration><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>24</duration><staff>2</staff></note>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>12</duration><staff>2</staff></note>
      <note><rest/><duration>12</duration><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

const out = fixCrossStaffBackupDurationsInXml(xml);
const m = out.match(/<backup>\s*<duration>(\d+)<\/duration>\s*<\/backup>/);
assert.ok(m, 'backup present');
assert.equal(m[1], '48', `backup must be RH timeline 48, got ${m[1]}`);
console.log('test_fix_cross_staff_backup_preview: OK');
