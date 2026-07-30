/**
 * m64 패턴: PR half 뒤 `<forward d24 voice=2>` 가 PL split 후 선두에 남으면
 * PL이 2분음만큼 늦게 시작함. PR voice forward는 제거, PL 자체 leading forward는 유지.
 * Run: node _smoke/test_prune_pl_stale_forward.mjs
 */
import { JSDOM } from 'jsdom';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview.ts';

const dom = new JSDOM('<!DOCTYPE html>');
const { DOMParser } = dom.window;
globalThis.DOMParser = DOMParser;

function local(el) {
  return el.localName?.toLowerCase() ?? String(el.tagName).toLowerCase();
}

function dump(measure) {
  return [...measure.children]
    .map((c) => {
      const t = local(c);
      if (t === 'note') {
        const st = c.querySelector('staff')?.textContent ?? '1';
        const v = c.querySelector('voice')?.textContent ?? '?';
        return `note s${st} v${v}`;
      }
      if (t === 'forward' || t === 'backup') {
        const d = c.querySelector('duration')?.textContent ?? '?';
        const v = c.querySelector('voice')?.textContent;
        return `${t} d${d}${v ? ` v${v}` : ''}`;
      }
      return t;
    })
    .join('|');
}

function firstNoteOnset(measure) {
  let lastV = '1';
  const cursor = new Map();
  for (const c of [...measure.children]) {
    const t = local(c);
    if (t === 'backup') {
      const v = c.querySelector('voice')?.textContent?.trim() || lastV;
      const d = parseInt(c.querySelector('duration')?.textContent || '0', 10);
      cursor.set(v, Math.max(0, (cursor.get(v) ?? 0) - d));
    } else if (t === 'forward') {
      const v = c.querySelector('voice')?.textContent?.trim() || lastV;
      const d = parseInt(c.querySelector('duration')?.textContent || '0', 10);
      cursor.set(v, (cursor.get(v) ?? 0) + d);
    } else if (t === 'note') {
      const v = c.querySelector('voice')?.textContent?.trim() || '1';
      lastV = v;
      return cursor.get(v) ?? 0;
    }
  }
  return -1;
}

// After staff-1 notes removed (simulate PL filter input to prune)
const stalePrForward = `<?xml version="1.0"?>
<score-partwise version="3.1">
<part id="P5"><measure number="64">
<backup><duration>48</duration></backup>
<forward><duration>24</duration><voice>2</voice></forward>
<backup><duration>48</duration></backup>
<note><pitch><step>B</step><octave>2</octave></pitch><duration>6</duration><type>eighth</type><staff>2</staff><voice>5</voice></note>
</measure></part>
</score-partwise>`;

const doc = new DOMParser().parseFromString(stalePrForward, 'text/xml');
const m = doc.getElementsByTagName('measure')[0];
console.log('before', dump(m), 'onset', firstNoteOnset(m));
pruneCrossStaffTimelineForOsmdPreview(m, 2);
console.log('after ', dump(m), 'onset', firstNoteOnset(m));

if (dump(m).includes('forward')) {
  console.error('FAIL: stale PR forward v2 still present');
  process.exit(1);
}
if (firstNoteOnset(m) !== 0) {
  console.error('FAIL: PL first note onset should be 0, got', firstNoteOnset(m));
  process.exit(1);
}

// Genuine PL mid-measure start: forward v5 before PL note v5 must remain
const plLead = `<?xml version="1.0"?>
<score-partwise version="3.1">
<part id="P5"><measure number="2">
<forward><duration>8</duration><voice>5</voice></forward>
<note><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part>
</score-partwise>`;
const doc2 = new DOMParser().parseFromString(plLead, 'text/xml');
const m2 = doc2.getElementsByTagName('measure')[0];
pruneCrossStaffTimelineForOsmdPreview(m2, 2);
console.log('pl-lead', dump(m2), 'onset', firstNoteOnset(m2));
if (!dump(m2).includes('forward d8 v5')) {
  console.error('FAIL: genuine PL leading forward removed');
  process.exit(1);
}
if (firstNoteOnset(m2) !== 8) {
  console.error('FAIL: PL lead onset should be 8, got', firstNoteOnset(m2));
  process.exit(1);
}

console.log('prune pl stale forward ok');
