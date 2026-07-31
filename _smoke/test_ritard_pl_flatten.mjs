/**
 * PL with 2 voices + ritard — flatten moves note before direction; does anchor fail?
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
function timelineDurationEl(el) {
  const d = el.querySelector(':scope > duration, :scope > *|duration');
  return parseInt(d?.textContent?.trim() || '0', 10) || 0;
}
function staffTimedNotesInMeasure(measure) {
  const voiceCursor = new Map();
  let lastNoteVoice = '1';
  const out = [];
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'backup') {
      const dur = timelineDurationEl(child);
      voiceCursor.set(lastNoteVoice, Math.max(0, (voiceCursor.get(lastNoteVoice) ?? 0) - dur));
    } else if (tag === 'forward') {
      const dur = timelineDurationEl(child);
      const v = child.querySelector(':scope > voice')?.textContent?.trim() || lastNoteVoice;
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + dur);
    } else if (tag === 'note') {
      const voice = noteVoiceN(child);
      lastNoteVoice = voice;
      const t = voiceCursor.get(voice) ?? 0;
      out.push({ note: child, time: t, voice });
      if (!isChordNote(child)) voiceCursor.set(voice, t + noteDurationN(child));
    }
  }
  return out;
}
function measureMusicalContentInsertIndex(measure) {
  for (let i = 0; i < measure.children.length; i++) {
    const tag = xmlLocalName(measure.children[i]);
    if (tag === 'attributes' || tag === 'print') continue;
    return i;
  }
  return measure.children.length;
}
function flatten(measure) {
  const timed = staffTimedNotesInMeasure(measure);
  const voices = new Set(timed.map((x) => x.voice));
  if (timed.length < 2 || voices.size < 2) {
    console.log('skip flatten', timed.length, voices);
    return;
  }
  timed.sort((a, b) => a.time - b.time || Number(a.voice) - Number(b.voice));
  const doc = measure.ownerDocument;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const mk = (local) => doc.createElementNS(ns, local);
  for (const el of [...measure.children].filter((c) => ['note', 'backup', 'forward'].includes(xmlLocalName(c)))) {
    measure.removeChild(el);
  }
  let insertAt = measureMusicalContentInsertIndex(measure);
  let cursor = 0;
  for (const { note, time } of timed) {
    if (time > cursor) {
      const fwd = mk('forward');
      const durEl = mk('duration');
      durEl.textContent = String(time - cursor);
      fwd.appendChild(durEl);
      measure.insertBefore(fwd, measure.children[insertAt] ?? null);
      insertAt++;
      cursor = time;
    }
    const clone = note.cloneNode(true);
    clone.querySelectorAll('voice, *|voice').forEach((v) => {
      v.textContent = '1';
    });
    measure.insertBefore(clone, measure.children[insertAt] ?? null);
    insertAt++;
    if (!isChordNote(clone)) cursor = time + noteDurationN(clone);
  }
}
function anchorNoteForDirection(measure, direction) {
  const children = [...measure.children];
  const idx = children.indexOf(direction);
  const wantVoice = directionVoiceText(direction);
  const staffEl = direction.querySelector(':scope > staff, :scope > *|staff');
  const wantStaff = staffEl?.textContent ? parseInt(staffEl.textContent, 10) : null;
  const next = idx + 1 < children.length ? children[idx + 1] : null;
  console.log('dir idx', idx, 'next', next && xmlLocalName(next), 'wantV', wantVoice, 'wantS', wantStaff);
  if (next && xmlLocalName(next) === 'note') {
    const nStaff = noteStaffN(next);
    if (wantStaff === null || nStaff === wantStaff) {
      if (!wantVoice) return next;
      const nv = next.querySelector(':scope > voice')?.textContent?.trim();
      if (!nv || nv === wantVoice) return next;
      console.log('next voice mismatch', nv, wantVoice);
    }
  }
  if (wantVoice) {
    for (const c of children) {
      if (xmlLocalName(c) !== 'note') continue;
      if (wantStaff !== null && noteStaffN(c) !== wantStaff) continue;
      if (c.querySelector(':scope > voice')?.textContent?.trim() === wantVoice) return c;
    }
    console.log('no voice match');
  }
  if (wantStaff !== null) return firstNoteOnStaff(measure, wantStaff);
  return null;
}

const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
<part id="P5"><measure number="62">
<attributes><divisions>2</divisions><staves>2</staves></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type><staff>1</staff><voice>1</voice></note>
<backup><duration>2</duration></backup>
<direction placement="above"><direction-type><words>ritard.</words></direction-type><staff>2</staff><voice>5</voice></direction>
<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>eighth</type><staff>2</staff><voice>5</voice></note>
<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><type>eighth</type><staff>2</staff><voice>6</voice></note>
</measure></part>
</score-partwise>`;

const dom = new JSDOM('<!DOCTYPE html>');
const doc = new dom.window.DOMParser().parseFromString(xml, 'text/xml');
const measure = doc.getElementsByTagName('measure')[0];
// remove staff1
for (const c of [...measure.children]) {
  if (xmlLocalName(c) === 'note' && noteStaffN(c) !== 2) c.remove();
}
// prune backup
for (const c of [...measure.children]) {
  if (xmlLocalName(c) === 'backup') c.remove();
}
console.log('pre-flatten', [...measure.children].map((c) => xmlLocalName(c)).join('|'));
flatten(measure);
console.log('post-flatten', [...measure.children].map((c) => {
  if (xmlLocalName(c) === 'note') return `note:s${noteStaffN(c)}:v${noteVoiceN(c)}`;
  if (xmlLocalName(c) === 'direction') return `dir:v${directionVoiceText(c)}`;
  return xmlLocalName(c);
}).join('|'));

for (const child of [...measure.children]) {
  if (xmlLocalName(child) !== 'direction') continue;
  const anchor = anchorNoteForDirection(measure, child);
  console.log('anchor?', !!anchor, anchor && `s${noteStaffN(anchor)} v${noteVoiceN(anchor)}`);
  if (!anchor || noteStaffN(anchor) !== 2) {
    console.log('WOULD REMOVE');
    child.remove();
  }
}
console.log('words left', [...measure.querySelectorAll('words')].map((w) => w.textContent));
