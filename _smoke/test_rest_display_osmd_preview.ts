/**
 * HITL 미리보기 rest display-step 정리 검증.
 * Run: npx tsx _smoke/test_rest_display_osmd_preview.ts
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay';

const dom = new JSDOM('');
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

function countMeasureRestDisplayD(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  let n = 0;
  for (const rest of doc.querySelectorAll('rest[measure="yes"]')) {
    const step = rest.querySelector(':scope > display-step, :scope > *|display-step')?.textContent?.trim().toUpperCase();
    if (step === 'D') n += 1;
  }
  return n;
}

function xmlLocalName(el: Element): string {
  return (el.localName || el.tagName).toLowerCase();
}

function leftoverHintsArePinnedShortRests(xml: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const part of doc.querySelectorAll('part')) {
    const clefByStaff = new Map<number, { sign: string; line: number }>();
    for (const measure of [...part.children]) {
      if (xmlLocalName(measure) !== 'measure') continue;
      const voicesByStaff = new Map<number, Set<string>>();
      for (const child of [...measure.children]) {
        if (xmlLocalName(child) === 'attributes') {
          for (const clef of [...child.children]) {
            if (xmlLocalName(clef) !== 'clef') continue;
            const numRaw = clef.getAttribute('number');
            const staffN = numRaw && /^\d+$/.test(numRaw) ? parseInt(numRaw, 10) : 1;
            const sign = clef.querySelector('sign, *|sign')?.textContent?.trim() || 'G';
            const lineRaw = clef.querySelector('line, *|line')?.textContent?.trim() || '';
            const line = parseInt(lineRaw, 10);
            clefByStaff.set(staffN, { sign, line: Number.isFinite(line) ? line : 2 });
          }
        }
        if (xmlLocalName(child) !== 'note') continue;
        const staffEl = child.querySelector(':scope > staff, :scope > *|staff');
        const staff = parseInt(staffEl?.textContent?.trim() ?? '1', 10) || 1;
        const voice = child.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || '1';
        const set = voicesByStaff.get(staff) ?? new Set<string>();
        set.add(voice);
        voicesByStaff.set(staff, set);
      }
      for (const note of [...measure.children]) {
        if (xmlLocalName(note) !== 'note') continue;
        const rest = note.querySelector(':scope > rest, :scope > *|rest');
        if (!rest) continue;
        const step = rest.querySelector(':scope > display-step, :scope > *|display-step')?.textContent?.trim();
        const oct = rest.querySelector(':scope > display-octave, :scope > *|display-octave')?.textContent?.trim();
        if (!step && !oct) continue;
        if (rest.getAttribute('measure') === 'yes') return false;
        const type = note.querySelector(':scope > type, :scope > *|type')?.textContent?.trim() || '';
        if (!['quarter', 'eighth', '16th', '32nd', '64th', '128th'].includes(type)) return false;
        const staffEl = note.querySelector(':scope > staff, :scope > *|staff');
        const staff = parseInt(staffEl?.textContent?.trim() ?? '1', 10) || 1;
        if ((voicesByStaff.get(staff)?.size ?? 0) < 2) return false;
        const clef = clefByStaff.get(staff) ?? { sign: staff >= 2 ? 'F' : 'G', line: staff >= 2 ? 4 : 2 };
        const expect =
          clef.sign.toUpperCase() === 'F'
            ? { step: 'D', oct: '3' }
            : clef.sign.toUpperCase() === 'C' && clef.line === 4
              ? { step: 'A', oct: '3' }
              : clef.sign.toUpperCase() === 'C'
                ? { step: 'C', oct: '4' }
                : { step: 'B', oct: '4' };
        if (step !== expect.step || oct !== expect.oct) return false;
      }
    }
  }
  return true;
}

const pianoPl = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part id="P5">
    <measure number="4">
      <attributes>
        <divisions>8</divisions>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <rest><display-step>A</display-step><display-octave>3</display-octave></rest>
        <duration>4</duration>
        <voice>5</voice>
        <type>eighth</type>
        <staff>2</staff>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>16</duration>
        <voice>6</voice>
        <type>whole</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;

const pinned = repairRestDisplayForOsmdPreview(pianoPl);
const pinDoc = new DOMParser().parseFromString(pinned, 'application/xml');
const pinRest = pinDoc.querySelector('rest');
const pinStep = pinRest?.querySelector(':scope > display-step, :scope > *|display-step')?.textContent?.trim();
const pinOct = pinRest?.querySelector(':scope > display-octave, :scope > *|display-octave')?.textContent?.trim();
if (pinStep !== 'D' || pinOct !== '3') {
  console.error('expected F-clef polyphonic eighth rest pinned to D3, got', pinStep, pinOct);
  process.exit(1);
}
console.log('piano PL eighth rest pin: D3 ok');

const xmlPath = '_smoke/_6cbf_final/audiveris_raw/clean_score_only.xml';
if (fs.existsSync(xmlPath)) {
  const raw = fs.readFileSync(xmlPath, 'utf8');
  const fixed = repairRestDisplayForOsmdPreview(raw);
  const afterD = countMeasureRestDisplayD(fixed);
  console.log('measure rest display-step D after repair:', afterD);
  if (afterD !== 0) {
    console.error('expected no measure=yes rests with display-step D after repair');
    process.exit(1);
  }
  if (!leftoverHintsArePinnedShortRests(fixed)) {
    console.error('leftover display-step hints are not pinned polyphonic short rests');
    process.exit(1);
  }
} else {
  console.log('skip 6cbf fixture (missing)');
}

console.log('ok');
