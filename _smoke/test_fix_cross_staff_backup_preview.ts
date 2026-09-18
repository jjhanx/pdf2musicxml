/** Smoke: cross-staff backup stays at RH length through fix + faithful repairTimeline. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fixCrossStaffBackupDurationsInXml } from '../shared/musicXmlStaffPreview.ts';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P5">
    <measure number="1">
      <attributes><divisions>4</divisions><staves>2</staves>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><rest/><duration>16</duration><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><rest/><duration>16</duration><staff>2</staff></note>
    </measure>
    <measure number="8">
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>C</step><octave>6</octave></pitch><duration>24</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>C</step><octave>6</octave></pitch><duration>12</duration><voice>1</voice><staff>1</staff></note>
      <note><rest/><duration>12</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>24</duration><voice>5</voice><staff>2</staff></note>
      <note><pitch><step>C</step><octave>2</octave></pitch><duration>12</duration><voice>5</voice><staff>2</staff></note>
      <note><rest/><duration>12</duration><voice>5</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

const fixed = fixCrossStaffBackupDurationsInXml(xml);
const m1 = fixed.match(/<measure number="8">[\s\S]*?<backup>\s*<duration>(\d+)<\/duration>\s*<\/backup>/);
assert.ok(m1, 'backup present after fix');
assert.equal(m1![1], '48', `fix must set RH timeline 48, got ${m1![1]}`);

const repaired = repairTimelineForOsmdPreview(fixed, { faithfulEditorLayout: true });
const m2 = repaired.match(/<measure number="8">[\s\S]*?<backup>\s*<duration>(\d+)<\/duration>\s*<\/backup>/);
assert.ok(m2, 'backup present after repairTimeline');
assert.equal(m2![1], '48', `faithful cap must not shrink PR→PL backup, got ${m2![1]}`);
console.log('test_fix_cross_staff_backup_preview: OK');
