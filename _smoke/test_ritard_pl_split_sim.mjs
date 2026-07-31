/**
 * Simulate PL staff split on ritard direction — no OSMD import.
 * Run: node _smoke/test_ritard_pl_split_sim.mjs
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const xmlLocalName = (el) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function noteStaffN(noteEl) {
  const staffEl = noteEl.querySelector(':scope > staff, :scope > *|staff');
  if (!staffEl) return 1;
  const n = parseInt(staffEl.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
}

function noteVoiceN(note) {
  return note.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim() || '1';
}

function noteDurationN(note) {
  const d = note.querySelector(':scope > duration, :scope > *|duration');
  return parseInt(d?.textContent?.trim() || '0', 10) || 0;
}

function isChordNote(note) {
  return !!note.querySelector(':scope > chord, :scope > *|chord');
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
  const wantStaff = staffEl && staffEl.textContent ? parseInt(staffEl.textContent, 10) : null;

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
      const nStaff = noteStaffN(c);
      if (wantStaff === null || nStaff === wantStaff) {
        const nv = c.querySelector(':scope > voice, :scope > *|voice')?.textContent?.trim();
        if (nv === wantVoice) return c;
      }
    }
  }
  if (wantStaff !== null) {
    return firstNoteOnStaff(measure, wantStaff);
  }
  return null;
}

function measureMusicalContentInsertIndex(measure) {
  for (let i = 0; i < measure.children.length; i += 1) {
    const tag = xmlLocalName(measure.children[i]);
    if (tag === 'attributes' || tag === 'print') continue;
    if (tag === 'barline' && measure.children[i].getAttribute('location') === 'right') continue;
    return i;
  }
  return measure.children.length;
}

function staffTimedNotesInMeasure(measure) {
  const voiceCursor = new Map();
  let lastNoteVoice = '1';
  const out = [];
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'backup') {
      const dur = noteDurationN(child);
      const v = lastNoteVoice;
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - dur));
    } else if (tag === 'note') {
      const voice = noteVoiceN(child);
      lastNoteVoice = voice;
      const t = voiceCursor.get(voice) ?? 0;
      const dur = noteDurationN(child);
      out.push({ note: child, time: t, voice });
      if (!isChordNote(child)) voiceCursor.set(voice, t + dur);
    }
  }
  return out;
}

function flattenNonOverlappingStaffVoicesForOsmd(measure) {
  const timed = staffTimedNotesInMeasure(measure);
  if (timed.length < 2) return; // early exit — single voice after PL filter!
  // ...
}

function prune(measure, staffN) {
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag !== 'backup' && tag !== 'forward') continue;
    const idx = [...measure.children].indexOf(child);
    let prevStaff = null;
    for (let j = idx - 1; j >= 0; j--) {
      if (xmlLocalName(measure.children[j]) === 'note') {
        prevStaff = noteStaffN(measure.children[j]);
        break;
      }
    }
    let nextStaff = null;
    for (let j = idx + 1; j < measure.children.length; j++) {
      if (xmlLocalName(measure.children[j]) === 'note') {
        nextStaff = noteStaffN(measure.children[j]);
        break;
      }
    }
    if (nextStaff !== staffN) {
      child.remove();
      continue;
    }
    if (tag === 'forward' && prevStaff === null) continue;
    if (prevStaff === null || prevStaff !== staffN) child.remove();
  }
}

function transform(measure, staffN) {
  for (const child of [...measure.children]) {
    if (xmlLocalName(child) === 'note' && noteStaffN(child) !== staffN) child.remove();
  }
  prune(measure, staffN);
  console.log('after prune:', [...measure.children].map((c) => xmlLocalName(c) + (xmlLocalName(c)==='note'?` s${noteStaffN(c)} v${noteVoiceN(c)}`:'') + (xmlLocalName(c)==='direction'?` v=${directionVoiceText(c)}`:'')).join(' | '));

  const timed = staffTimedNotesInMeasure(measure);
  console.log('timed voices', new Set(timed.map((t) => t.voice)), 'len', timed.length);
  // flatten only if >=2 voices
  if (timed.length >= 2 && new Set(timed.map((t) => t.voice)).size >= 2) {
    console.log('WOULD FLATTEN');
  }

  for (const child of [...measure.children]) {
    if (xmlLocalName(child) !== 'direction') continue;
    const anchor = anchorNoteForDirection(measure, child);
    console.log('anchor', !!anchor, anchor && noteStaffN(anchor), 'want staff', staffN);
    if (!anchor || noteStaffN(anchor) !== staffN) {
      console.log('REMOVE direction');
      child.remove();
    }
  }
  console.log('final words', [...measure.querySelectorAll('words')].map((w) => w.textContent));
}

const xml = fs.readFileSync('_smoke/_tmp_ritard_pl.xml', 'utf8');
const dom = new JSDOM(`<!DOCTYPE html><body></body>`, { contentType: 'text/html' });
global.document = dom.window.document;
const doc = new dom.window.DOMParser().parseFromString(xml, 'text/xml');
const p5 = [...doc.getElementsByTagName('part')].find((p) => p.getAttribute('id') === 'P5');
const measure = p5.getElementsByTagName('measure')[0];
transform(measure, 2);
