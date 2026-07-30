/**
 * HITL verbatim: PL staff=2 ritard. must survive split (no AudiverisInspectPanel import).
 * Reproduces transform order: reattach directions BEFORE rewriting note staff → 1.
 * Run: node _smoke/test_ritard_pl_verbatim_order.mjs
 */
import { JSDOM } from 'jsdom';

const xmlLocalName = (el) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function noteStaffN(noteEl) {
  const staffEl = noteEl.querySelector(':scope > staff, :scope > *|staff');
  if (!staffEl) return 1;
  const n = parseInt(staffEl.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
}

function directionVoiceText(direction) {
  return direction.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || null;
}

function firstNoteOnStaff(measure, staffN) {
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note' && noteStaffN(child) === staffN) return child;
  }
  return null;
}

function anchorNoteForDirection(measure, direction) {
  const children = [...measure.children];
  const idx = children.indexOf(direction);
  if (idx < 0) return null;
  const wantVoice = directionVoiceText(direction);
  const staffEl = direction.querySelector(':scope > staff, :scope > *|staff');
  const wantStaff = staffEl?.textContent ? parseInt(staffEl.textContent, 10) : null;
  const next = idx + 1 < children.length ? children[idx + 1] : null;
  if (next && xmlLocalName(next) === 'note') {
    const nStaff = noteStaffN(next);
    if (wantStaff === null || nStaff === wantStaff) {
      if (!wantVoice) return next;
      const nv = next.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
      if (!nv || nv === wantVoice) return next;
    }
  }
  if (wantVoice) {
    for (const c of children) {
      if (xmlLocalName(c) !== 'note') continue;
      if (wantStaff !== null && noteStaffN(c) !== wantStaff) continue;
      if (c.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() === wantVoice) {
        return c;
      }
    }
  }
  if (wantStaff !== null) return firstNoteOnStaff(measure, wantStaff);
  return null;
}

function reattach(measure, staffN) {
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'direction') continue;
    const anchor = anchorNoteForDirection(measure, child);
    if (!anchor || noteStaffN(anchor) !== staffN) {
      child.remove();
      continue;
    }
  }
}

function wordsLeft(measure) {
  return [...measure.querySelectorAll('words')].map((w) => w.textContent);
}

function cloneMeasure() {
  const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
<part id="P5"><measure number="62">
<attributes><divisions>2</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff><voice>1</voice></note>
<backup><duration>2</duration></backup>
<direction placement="above"><direction-type><words>ritard.</words></direction-type><staff>2</staff><voice>5</voice></direction>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><type>quarter</type><staff>2</staff><voice>5</voice></note>
</measure></part>
</score-partwise>`;
  const dom = new JSDOM('<!DOCTYPE html>');
  const doc = new dom.window.DOMParser().parseFromString(xml, 'text/xml');
  const measure = doc.getElementsByTagName('measure')[0];
  for (const c of [...measure.children]) {
    if (xmlLocalName(c) === 'note' && noteStaffN(c) !== 2) c.remove();
    if (xmlLocalName(c) === 'backup') c.remove();
  }
  return measure;
}

// BUG order (pre-fix): rewrite note staff to 1, then reattach with staffN=2 → drops ritard
{
  const m = cloneMeasure();
  m.querySelectorAll('note staff, note *|staff').forEach((el) => {
    el.textContent = '1';
  });
  reattach(m, 2);
  if (wordsLeft(m).some((w) => w.includes('ritard'))) {
    console.error('FAIL: bug-order unexpectedly kept ritard (test expectation changed)');
    process.exit(1);
  }
  console.log('bug-order drops ritard (expected)');
}

// FIX order: reattach while notes still staff=2, then rewrite
{
  const m = cloneMeasure();
  reattach(m, 2);
  m.querySelectorAll('note staff, note *|staff').forEach((el) => {
    el.textContent = '1';
  });
  if (!wordsLeft(m).some((w) => w.includes('ritard'))) {
    console.error('FAIL: fix-order lost ritard');
    process.exit(1);
  }
  console.log('fix-order keeps ritard ok');
}

console.log('ritard pl verbatim order ok');
