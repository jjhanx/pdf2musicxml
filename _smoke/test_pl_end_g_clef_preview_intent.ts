/**
 * PL end insertClef+remap: current measure XML unchanged; next measure gets G + remapped pitch.
 * Run: npx tsx _smoke/test_pl_end_g_clef_preview_intent.ts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup';
import { removeRedundantCourtesyClefsForOsmd } from '../shared/musicXmlCourtesyClef';
import {
  anchorTrailingMidClefsForOsmdPreview,
  anchorTrailingMidClefsInMeasure,
} from '../shared/musicXmlMidClefOsmdAnchor';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const local = (el: Element) => (el.localName || el.tagName).toLowerCase();
const noteStaffN = (note: Element) => {
  const n = parseInt(note.querySelector(':scope > staff')?.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
};

const RAW = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>Piano</part-name></score-part></part-list>
  <part id="P5">
    <measure number="52">
      <attributes>
        <divisions>4</divisions>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>16</duration><type>whole</type><voice>5</voice><staff>2</staff></note>
    </measure>
    <measure number="53">
      <attributes>
        <divisions>4</divisions>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration><type>whole</type><voice>1</voice><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>16</duration><type>whole</type><voice>5</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

function applyInsertViaPython(xml: string): string {
  const inPath = join(tmpdir(), `clef_in_${Date.now()}.xml`);
  const outPath = join(tmpdir(), `clef_out_${Date.now()}.xml`);
  const pyPath = join(tmpdir(), `clef_apply_${Date.now()}.py`);
  writeFileSync(inPath, xml, 'utf8');
  writeFileSync(
    pyPath,
    `
import sys, xml.etree.ElementTree as ET
sys.path.insert(0, r${JSON.stringify(join(process.cwd(), 'scripts'))})
from omr_hitl_lib import apply_fixes_to_root
root = ET.parse(r${JSON.stringify(inPath)}).getroot()
apply_fixes_to_root(root, [{
  "kind": "insertClef",
  "partId": "P5",
  "measureMxl": "52",
  "afterNoteIndex": 1,
  "clefSign": "G",
  "clefLine": 2,
  "staff": 2,
  "remapStaffPitches": True,
}])
ET.ElementTree(root).write(r${JSON.stringify(outPath)}, encoding="unicode")
`,
    'utf8',
  );
  try {
    execFileSync('python', [pyPath], { stdio: 'pipe' });
    return readFileSync(outPath, 'utf8');
  } finally {
    try {
      unlinkSync(inPath);
      unlinkSync(outPath);
      unlinkSync(pyPath);
    } catch {
      /* ignore */
    }
  }
}

function toPlPreviewXml(rawXml: string): string {
  let xml = repairTimelineForOsmdPreview(rawXml, { faithfulEditorLayout: true });
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const measure of [...doc.querySelectorAll('measure')]) {
    let seenNote = false;
    for (const child of [...measure.children]) {
      const tag = local(child);
      if (tag === 'note') {
        seenNote = true;
        continue;
      }
      if (tag !== 'attributes') continue;
      if (!seenNote) {
        let st = [...child.children].find((c) => local(c) === 'staves');
        if (!st) {
          st = child.ownerDocument!.createElement('staves');
          child.insertBefore(st, child.firstChild);
        }
        st.textContent = '1';
      }
      for (const clef of [...child.children].filter((c) => local(c) === 'clef')) {
        const num = parseInt(clef.getAttribute('number') ?? '', 10);
        if (Number.isFinite(num) && num !== 2) clef.remove();
        else if (clef.getAttribute('number')) clef.setAttribute('number', '1');
      }
      if (![...child.children].length) child.remove();
    }
    for (const c of [...measure.children]) {
      if (local(c) === 'note' && noteStaffN(c) !== 2) c.remove();
    }
    pruneCrossStaffTimelineForOsmdPreview(measure, 2);
    measure.querySelectorAll('note staff').forEach((el) => {
      el.textContent = '1';
    });
    anchorTrailingMidClefsInMeasure(measure);
  }
  xml = new XMLSerializer().serializeToString(doc);
  xml = removeRedundantCourtesyClefsForOsmd(xml);
  xml = anchorTrailingMidClefsForOsmdPreview(xml);
  return xml;
}

function measureOrder(xml: string, measureNumber: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const m = [...doc.querySelectorAll('measure')].find(
    (el) => el.getAttribute('number') === measureNumber,
  );
  assert.ok(m, `measure ${measureNumber}`);
  const out: string[] = [];
  for (const c of [...m!.children]) {
    const tag = c.localName;
    if (tag === 'note') {
      if (c.querySelector(':scope > rest')) {
        out.push(c.getAttribute('print-object') === 'no' ? 'rest:hidden' : 'rest');
      } else {
        const step = c.querySelector('step')?.textContent ?? '';
        const oct = c.querySelector('octave')?.textContent ?? '';
        out.push(`note:${step}${oct}`);
      }
    } else if (tag === 'attributes') {
      for (const cl of [...c.querySelectorAll('clef')]) {
        out.push(`clef:${cl.querySelector('sign')?.textContent}`);
      }
    }
  }
  return out;
}

function pitchStaff2(xml: string, measureNumber: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const m = [...doc.querySelectorAll('measure')].find(
    (el) => el.getAttribute('number') === measureNumber,
  )!;
  const out: string[] = [];
  for (const n of [...m.querySelectorAll(':scope > note')]) {
    if ((n.querySelector('staff')?.textContent ?? '1') !== '2') continue;
    const p = n.querySelector('pitch');
    if (!p) continue;
    out.push(`${p.querySelector('step')?.textContent}${p.querySelector('octave')?.textContent}`);
  }
  return out;
}

function measureOrderStaff2(xml: string, measureNumber: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const m = [...doc.querySelectorAll('measure')].find(
    (el) => el.getAttribute('number') === measureNumber,
  );
  assert.ok(m, `measure ${measureNumber}`);
  const out: string[] = [];
  for (const c of [...m!.children]) {
    const tag = c.localName;
    if (tag === 'note') {
      const st = c.querySelector('staff')?.textContent ?? '1';
      if (st !== '2') continue;
      if (c.querySelector(':scope > rest')) {
        out.push(c.getAttribute('print-object') === 'no' ? 'rest:hidden' : 'rest');
      } else {
        const step = c.querySelector('step')?.textContent ?? '';
        const oct = c.querySelector('octave')?.textContent ?? '';
        out.push(`note:${step}${oct}`);
      }
    } else if (tag === 'attributes') {
      for (const cl of [...c.querySelectorAll('clef')]) {
        const num = cl.getAttribute('number');
        if (num && num !== '2') continue;
        if (!num) continue; // unnumbered = staff1
        out.push(`clef:${cl.querySelector('sign')?.textContent}`);
      }
    }
  }
  return out;
}

const fixed = applyInsertViaPython(RAW);
assert.deepEqual(pitchStaff2(fixed, '52'), ['F3'], `m52 front pitch: ${pitchStaff2(fixed, '52')}`);
assert.deepEqual(pitchStaff2(fixed, '53'), ['D5'], `m53 remapped: ${pitchStaff2(fixed, '53')}`);

const m52raw = measureOrderStaff2(fixed, '52');
assert.ok(!m52raw.includes('clef:G'), `end insert must not put G in m52 staff2: ${m52raw.join(' ')}`);
assert.ok(m52raw.includes('clef:F') && m52raw.includes('note:F3'), m52raw.join(' '));

const m53raw = measureOrderStaff2(fixed, '53');
assert.ok(m53raw.includes('clef:G'), `m53 header G: ${m53raw.join(' ')}`);
assert.ok(!m53raw.includes('clef:F'), `m53 no F: ${m53raw.join(' ')}`);

const preview = toPlPreviewXml(fixed);
const m52prev = measureOrder(preview, '52');
const m53prev = measureOrder(preview, '53');
console.log('preview m52', m52prev.join(' → '));
console.log('preview m53', m53prev.join(' → '));

assert.ok(m52prev.includes('clef:F'), `preview keeps F: ${m52prev.join(' ')}`);
assert.ok(!m52prev.includes('clef:G'), `preview m52 no G: ${m52prev.join(' ')}`);
assert.ok(m52prev.some((x) => x.startsWith('note:F')), m52prev.join(' '));
assert.ok(!m53prev.includes('clef:F'), `preview m53 no F: ${m53prev.join(' ')}`);
assert.ok(m53prev.some((x) => x.startsWith('note:D')), m53prev.join(' '));

console.log('pl end G clef preview intent ok');
