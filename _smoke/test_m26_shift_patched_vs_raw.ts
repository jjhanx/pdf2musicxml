/**
 * Detect m26→m27 shift on patched vs raw review content.
 * Run: npx tsx _smoke/test_m26_shift_patced_vs_raw.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:2400px;height:14000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window,
  DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

// inline split + pipeline from test_cheongsan_m26_osmd_m27.ts (abbreviated)
function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }
function noteStaff(note: Element) { return parseInt(note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() ?? '1', 10) || 1; }
function noteDurationN(note: Element) { return parseInt(note.querySelector(':scope > duration, :scope > *|duration')?.textContent ?? '0', 10); }
function isChordNote(note: Element) { return !!note.querySelector(':scope > chord, :scope > *|chord'); }

function staffTimedNotesInMeasure(measure: Element) {
  type T = { note: Element; time: number; voice: string };
  const out: T[] = []; let pos = 0; const voicePos = new Map<string, number>();
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'backup') pos = Math.max(0, pos - noteDurationN(child));
    else if (tag === 'forward') pos += noteDurationN(child);
    else if (tag === 'note') {
      if (isChordNote(child) || child.querySelector(':scope > grace, :scope > *|grace')) continue;
      const v = (child.querySelector(':scope > voice, :scope > *|voice')?.textContent ?? '1').trim() || '1';
      const t = voicePos.has(v) ? voicePos.get(v)! : pos;
      out.push({ note: child, time: t, voice: v });
      voicePos.set(v, t + noteDurationN(child)); pos = Math.max(pos, t + noteDurationN(child));
    }
  }
  return out;
}

function flattenNonOverlappingStaffVoicesForOsmd(measure: Element): void {
  const timed = staffTimedNotesInMeasure(measure);
  if (timed.length < 2 || new Set(timed.map((x) => x.voice)).size < 2) return;
  const spans = timed.filter((x) => !isChordNote(x.note)).map((x) => ({ voice: x.voice, start: x.time, end: x.time + noteDurationN(x.note) }));
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
    if (spans[i]!.voice === spans[j]!.voice) continue;
    const a = spans[i]!, b = spans[j]!;
    if (a.start < b.end && b.start < a.end) return;
  }
  timed.sort((a, b) => a.time - b.time || Number(a.voice) - Number(b.voice));
  const doc = measure.ownerDocument!; const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const mk = (name: string) => (ns ? doc.createElementNS(ns, name) : doc.createElement(name));
  for (const el of [...measure.children].filter((c) => ['note', 'backup', 'forward'].includes(local(c)))) measure.removeChild(el);
  let insertAt = [...measure.children].findIndex((c) => !['attributes', 'print'].includes(local(c)));
  if (insertAt < 0) insertAt = measure.children.length;
  let cursor = 0;
  for (const { note, time } of timed) {
    if (time > cursor) { const fwd = mk('forward'); const durEl = mk('duration'); durEl.textContent = String(time - cursor); fwd.appendChild(durEl); measure.insertBefore(fwd, measure.children[insertAt] ?? null); insertAt++; cursor = time; }
    const clone = note.cloneNode(true) as Element; clone.querySelectorAll('voice, *|voice').forEach((v) => { v.textContent = '1'; });
    measure.insertBefore(clone, measure.children[insertAt] ?? null); insertAt++;
    if (!isChordNote(clone)) cursor = time + noteDurationN(clone);
  }
}

function pruneCrossStaffTimeline(measure: Element, staffN: number): void {
  for (const child of [...measure.children]) {
    const tag = local(child); if (tag !== 'backup' && tag !== 'forward') continue;
    const idx = [...measure.children].indexOf(child);
    let prevStaff: number | null = null;
    for (let j = idx - 1; j >= 0; j--) if (local(measure.children[j]!) === 'note') { prevStaff = noteStaff(measure.children[j] as Element); break; }
    let nextStaff: number | null = null;
    for (let j = idx + 1; j < measure.children.length; j++) if (local(measure.children[j]!) === 'note') { nextStaff = noteStaff(measure.children[j] as Element); break; }
    if (nextStaff !== staffN) child.remove(); else if (prevStaff === null || prevStaff !== staffN) child.remove();
  }
}

function splitGrandStaff(xml: string): string {
  const doc = parseMusicXmlDocument(xml)!;
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id'); if (!pid || pid.includes('__')) continue;
    let max = 1; part.querySelectorAll('note staff, note *|staff').forEach((s) => { max = Math.max(max, parseInt(s.textContent ?? '1', 10)); });
    if (max < 2) continue;
    const mkPart = (sn: number, suf: string) => {
      const p = part.cloneNode(true) as Element; p.setAttribute('id', `${pid}__${suf}`);
      for (const m of [...p.children]) {
        if (local(m) !== 'measure') continue;
        for (const n of [...m.querySelectorAll('note')]) if (noteStaff(n) !== sn) n.remove();
        m.querySelectorAll('note staff, note *|staff').forEach((s) => { s.textContent = '1'; });
        pruneCrossStaffTimeline(m, sn); flattenNonOverlappingStaffVoicesForOsmd(m);
      }
      return p;
    };
    part.parentNode!.insertBefore(mkPart(1, 'PR'), part); part.parentNode!.insertBefore(mkPart(2, 'PL'), part); part.parentNode!.removeChild(part);
    if (partList) {
      const sp = [...partList.children].find((c) => local(c) === 'score-part' && c.getAttribute('id') === pid);
      if (sp) {
        const cl = (id: string) => { const n = sp.cloneNode(false) as Element; n.setAttribute('id', id); return n; };
        partList.insertBefore(cl(`${pid}__PR`), sp); partList.insertBefore(cl(`${pid}__PL`), sp); partList.removeChild(sp);
      }
    }
  }
  return serializeMusicXmlDocument(doc);
}

function buildPreview(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  xml = splitGrandStaff(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = repairMissingNoteTypesForOsmdPreview(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  const doc = parseMusicXmlDocument(xml);
  doc?.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return doc ? serializeMusicXmlDocument(doc) : xml;
}

function countP1(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mn: number): number {
  let n = 0;
  const sheet = (osmd as unknown as { Sheet?: { SourceMeasures?: Array<Record<string, unknown>> } }).Sheet;
  for (const sm of sheet?.SourceMeasures ?? []) {
    if (Number(sm.MeasureNumberXML ?? sm.MeasureNumber) !== mn) continue;
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      for (const se of ((c as Record<string, unknown>).StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        const inst = (se as Record<string, unknown>).ParentStaff as Record<string, unknown> | undefined;
        const instr = inst?.ParentInstrument as Record<string, unknown> | undefined;
        if (String(instr?.IdString ?? '') !== 'P1') continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          n += (((ve as Record<string, unknown>).Notes as unknown[]) ?? []).length;
        }
      }
    }
  }
  return n;
}

async function check(label: string, xmlPath: string) {
  const xml = buildPreview(readFileSync(xmlPath, 'utf8'));
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement; host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(xml); osmd.zoom = 0.35; osmd.render();
  const n26 = countP1(osmd, 26); const n27 = countP1(osmd, 27);
  console.log(label, { n26, n27 });
  if (n26 === 0) throw new Error(`${label}: m26 empty`);
  if (n27 === 0) throw new Error(`${label}: m27 empty`);
}

async function main() {
  await check('raw audiveris', '_smoke/_raw_cheongsan.xml');
  // patched review on disk if still present
  try {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip('청산에 살리라 F/_inspect_0ea5/review.mxl');
    const entry = zip.getEntries().find((e) => e.entryName.endsWith('.xml') && !e.entryName.toUpperCase().includes('META'));
    if (entry) {
      const patched = entry.getData().toString('utf8');
      const hasD5 = patched.includes('<step>D</step>') && patched.includes('number="26"');
      console.log('review.mxl has D5 m26 patch?', hasD5);
      if (hasD5) {
        const { writeFileSync } = await import('fs');
        writeFileSync('_smoke/_patched_review.xml', patched);
        try {
          await check('PATCHED review (user state)', '_smoke/_patched_review.xml');
        } catch (e) {
          console.log('PATCHED review FAIL (expected if no P5 backup):', String(e));
        }
      }
    }
  } catch (e) {
    console.log('skip patched review check', e);
  }
}

void main().catch((e) => { console.error('FAIL', e); process.exit(1); });
