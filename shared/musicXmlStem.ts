/**
 * OSMD/HITL — 같은 오선·같은 onset에 voice가 둘 이상이면
 * 낮은 voice=up, 나머지=down (OSMD 다성 관례). 빔 그룹·화음에 전파.
 * 편집기 MusicXML stem과 미리보기 줄기 방향 일치.
 */
import { parseMusicXmlDocument, serializeMusicXmlDocument } from './musicXmlParse';

const xmlLocalName = (el: Element) =>
  typeof el.localName === 'string' ? el.localName.toLowerCase() : String(el.tagName).toLowerCase();

function childText(parent: Element, name: string): string {
  for (const c of [...parent.children]) {
    if (xmlLocalName(c) === name) return (c.textContent || '').trim();
  }
  return '';
}

function noteVoiceStaff(note: Element): { voice: string; staff: string } {
  return {
    voice: childText(note, 'voice') || '1',
    staff: childText(note, 'staff') || '1',
  };
}

function elDuration(el: Element): number {
  const n = parseInt(childText(el, 'duration'), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isChord(note: Element): boolean {
  return [...note.children].some((c) => xmlLocalName(c) === 'chord');
}

function isPitched(note: Element): boolean {
  return [...note.children].some((c) => xmlLocalName(c) === 'pitch');
}

function isGraceOrCue(note: Element): boolean {
  return [...note.children].some((c) => {
    const t = xmlLocalName(c);
    return t === 'grace' || t === 'cue';
  });
}

function beamValues(note: Element): string[] {
  const out: string[] = [];
  for (const c of [...note.children]) {
    if (xmlLocalName(c) === 'beam' && c.textContent?.trim()) out.push(c.textContent.trim());
  }
  return out;
}

function timelineVoice(el: Element, fallback: string): string {
  const v = childText(el, 'voice');
  return v || fallback;
}

function setStem(note: Element, stem: 'up' | 'down'): boolean {
  let stemEl = [...note.children].find((c) => xmlLocalName(c) === 'stem');
  const cur = stemEl?.textContent?.trim().toLowerCase() ?? '';
  if (cur === stem) {
    stemEl?.removeAttribute('default-x');
    stemEl?.removeAttribute('default-y');
    return false;
  }
  const doc = note.ownerDocument;
  if (!doc) return false;
  if (!stemEl) {
    const ns = note.namespaceURI;
    stemEl = ns ? doc.createElementNS(ns, 'stem') : doc.createElement('stem');
    const staff = [...note.children].find((c) => xmlLocalName(c) === 'staff');
    if (staff) note.insertBefore(stemEl, staff);
    else note.appendChild(stemEl);
  }
  stemEl.textContent = stem;
  stemEl.removeAttribute('default-x');
  stemEl.removeAttribute('default-y');
  return true;
}

/** per-voice cursor onset for pitched chord leaders on staff (matches Python). */
function staffLeaderOnsets(measure: Element, staff: string): Map<Element, number> {
  const out = new Map<Element, number>();
  const voiceCursor = new Map<string, number>();
  let lastNoteVoice = '1';
  for (const child of [...measure.children]) {
    const tag = xmlLocalName(child);
    if (tag === 'backup') {
      const v = timelineVoice(child, lastNoteVoice);
      voiceCursor.set(v, Math.max(0, (voiceCursor.get(v) ?? 0) - elDuration(child)));
      continue;
    }
    if (tag === 'forward') {
      const v = timelineVoice(child, lastNoteVoice);
      voiceCursor.set(v, (voiceCursor.get(v) ?? 0) + elDuration(child));
      continue;
    }
    if (tag !== 'note' || isChord(child)) continue;
    const { voice, staff: st } = noteVoiceStaff(child);
    if (st !== staff) continue;
    lastNoteVoice = voice;
    const start = voiceCursor.get(voice) ?? 0;
    if (isPitched(child)) out.set(child, start);
    if (!isGraceOrCue(child)) voiceCursor.set(voice, start + elDuration(child));
  }
  return out;
}

function measureNotes(measure: Element): Element[] {
  return [...measure.children].filter((c) => xmlLocalName(c) === 'note');
}

function chordFollowers(notes: Element[], leaderIdx: number): Element[] {
  const out: Element[] = [];
  for (let j = leaderIdx + 1; j < notes.length; j++) {
    if (!isChord(notes[j]!)) break;
    out.push(notes[j]!);
  }
  return out;
}

/** Same staff+voice beam group; do not cross into prior group when leader is begin. */
function beamSpanNotes(notes: Element[], note: Element, staff: string): Element[] {
  const idx = notes.indexOf(note);
  if (idx < 0) return [note];
  const { voice: leaderVoice } = noteVoiceStaff(note);
  const beams = beamValues(note);
  const span = new Set<Element>([note]);
  for (const f of chordFollowers(notes, idx)) span.add(f);

  if (beams.length) {
    // forward
    for (let j = idx + 1; j < notes.length; j++) {
      const n = notes[j]!;
      const vs = noteVoiceStaff(n);
      if (vs.staff !== staff || vs.voice !== leaderVoice) break;
      if (isChord(n)) {
        span.add(n);
        continue;
      }
      const nb = beamValues(n);
      if (!nb.length) break;
      span.add(n);
      if (nb.includes('end')) break;
    }
    // backward only if not group begin
    if (!beams.includes('begin')) {
      for (let j = idx - 1; j >= 0; j--) {
        const n = notes[j]!;
        const vs = noteVoiceStaff(n);
        if (vs.staff !== staff || vs.voice !== leaderVoice) break;
        if (isChord(n)) {
          span.add(n);
          continue;
        }
        const nb = beamValues(n);
        if (!nb.length) break;
        span.add(n);
        for (const f of chordFollowers(notes, j)) span.add(f);
        if (nb.includes('begin')) break;
      }
    }
  }
  return [...span];
}

function normalizeMeasure(measure: Element): boolean {
  const notes = measureNotes(measure);
  const staffs = new Set<string>();
  for (const n of notes) {
    if (isChord(n) || !isPitched(n)) continue;
    staffs.add(noteVoiceStaff(n).staff);
  }
  let changed = false;
  for (const staff of [...staffs].sort()) {
    const onsets = staffLeaderOnsets(measure, staff);
    const byOnset = new Map<number, Map<string, Element[]>>();
    for (const [note, onset] of onsets) {
      const { voice } = noteVoiceStaff(note);
      let voices = byOnset.get(onset);
      if (!voices) {
        voices = new Map();
        byOnset.set(onset, voices);
      }
      const list = voices.get(voice) ?? [];
      list.push(note);
      voices.set(voice, list);
    }
    const forced = new Map<Element, 'up' | 'down'>();
    for (const voices of byOnset.values()) {
      if (voices.size < 2) continue;
      const order = [...voices.keys()].sort((a, b) => {
        const na = parseInt(a, 10);
        const nb = parseInt(b, 10);
        return (Number.isFinite(na) ? na : 999) - (Number.isFinite(nb) ? nb : 999);
      });
      order.forEach((voice, vi) => {
        const stem: 'up' | 'down' = vi === 0 ? 'up' : 'down';
        for (const note of voices.get(voice) ?? []) forced.set(note, stem);
      });
    }
    if (!forced.size) continue;
    const expanded = new Map(forced);
    for (const [note, stem] of forced) {
      for (const member of beamSpanNotes(notes, note, staff)) {
        const prev = expanded.get(member);
        if (!prev || (prev === 'up' && stem === 'down')) expanded.set(member, stem);
      }
    }
    for (const [note, stem] of expanded) {
      if (setStem(note, stem)) changed = true;
    }
  }
  return changed;
}

export function normalizeMultivoiceStemsForOsmdPreview(xml: string): string {
  try {
    const doc = parseMusicXmlDocument(xml);
    if (!doc) return xml;
    let changed = false;
    doc.querySelectorAll('measure, *|measure').forEach((m) => {
      if (normalizeMeasure(m)) changed = true;
    });
    return changed ? serializeMusicXmlDocument(doc) : xml;
  } catch {
    return xml;
  }
}
