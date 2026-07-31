/**
 * OMR panel width (~720px) — m26 must render (not 0-width / m27 shift).
 * Run: npx tsx _smoke/test_m26_narrow_osmd.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { measureMxlFromGraphic, forEachOsmdSystem, partIdFromGraphic } from '../src/osmdMeasureClick.ts';

function setupDom(hostWidth: number) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body><div id="host" style="width:${hostWidth}px;height:14000px"></div></body></html>`,
  );
  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 0;
    },
  });
  return dom.window.document.getElementById('host') as HTMLDivElement;
}

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function noteStaff(note: Element): number {
  return parseInt(note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() ?? '1', 10) || 1;
}

function noteDurationN(note: Element): number {
  return parseInt(note.querySelector(':scope > duration, :scope > *|duration')?.textContent ?? '0', 10);
}

function isChordNote(note: Element): boolean {
  return !!note.querySelector(':scope > chord, :scope > *|chord');
}

function staffTimedNotesInMeasure(measure: Element) {
  type T = { note: Element; time: number; voice: string };
  const out: T[] = [];
  let pos = 0;
  const voicePos = new Map<string, number>();
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag === 'backup') pos = Math.max(0, pos - noteDurationN(child));
    else if (tag === 'forward') pos += noteDurationN(child);
    else if (tag === 'note') {
      if (isChordNote(child) || child.querySelector(':scope > grace, :scope > *|grace')) continue;
      const v = (child.querySelector(':scope > voice, :scope > *|voice')?.textContent ?? '1').trim() || '1';
      const t = voicePos.has(v) ? voicePos.get(v)! : pos;
      out.push({ note: child, time: t, voice: v });
      voicePos.set(v, t + noteDurationN(child));
      pos = Math.max(pos, t + noteDurationN(child));
    }
  }
  return out;
}

function flattenNonOverlappingStaffVoicesForOsmd(measure: Element): void {
  const timed = staffTimedNotesInMeasure(measure);
  if (timed.length < 2 || new Set(timed.map((x) => x.voice)).size < 2) return;
  timed.sort((a, b) => a.time - b.time || Number(a.voice) - Number(b.voice));
  const doc = measure.ownerDocument!;
  const ns = measure.namespaceURI || 'http://www.musicxml.org/ns/partwise';
  const mk = (name: string) => (ns ? doc.createElementNS(ns, name) : doc.createElement(name));
  for (const el of [...measure.children].filter((c) => ['note', 'backup', 'forward'].includes(local(c)))) measure.removeChild(el);
  let insertAt = [...measure.children].findIndex((c) => !['attributes', 'print'].includes(local(c)));
  if (insertAt < 0) insertAt = measure.children.length;
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
    const clone = note.cloneNode(true) as Element;
    clone.querySelectorAll('voice, *|voice').forEach((v) => {
      v.textContent = '1';
    });
    measure.insertBefore(clone, measure.children[insertAt] ?? null);
    insertAt++;
    if (!isChordNote(clone)) cursor = time + noteDurationN(clone);
  }
}

function pruneCrossStaffTimeline(measure: Element, staffN: number): void {
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag !== 'backup' && tag !== 'forward') continue;
    const idx = [...measure.children].indexOf(child);
    let prevStaff: number | null = null;
    for (let j = idx - 1; j >= 0; j--) {
      if (local(measure.children[j]!) === 'note') {
        prevStaff = noteStaff(measure.children[j] as Element);
        break;
      }
    }
    let nextStaff: number | null = null;
    for (let j = idx + 1; j < measure.children.length; j++) {
      if (local(measure.children[j]!) === 'note') {
        nextStaff = noteStaff(measure.children[j] as Element);
        break;
      }
    }
    if (nextStaff !== staffN || prevStaff === null || prevStaff !== staffN) child.remove();
  }
}

function splitGrandStaff(xml: string): string {
  const doc = parseMusicXmlDocument(xml)!;
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id');
    if (!pid || pid.includes('__')) continue;
    let max = 1;
    part.querySelectorAll('note staff, note *|staff').forEach((s) => {
      max = Math.max(max, parseInt(s.textContent ?? '1', 10));
    });
    if (max < 2) continue;
    const mkPart = (sn: number, suf: string) => {
      const p = part.cloneNode(true) as Element;
      p.setAttribute('id', `${pid}__${suf}`);
      for (const m of [...p.children]) {
        if (local(m) !== 'measure') continue;
        for (const n of [...m.querySelectorAll('note')]) if (noteStaff(n) !== sn) n.remove();
        m.querySelectorAll('note staff, note *|staff').forEach((s) => {
          s.textContent = '1';
        });
        pruneCrossStaffTimeline(m, sn);
        flattenNonOverlappingStaffVoicesForOsmd(m);
      }
      return p;
    };
    part.parentNode!.insertBefore(mkPart(1, 'PR'), part);
    part.parentNode!.insertBefore(mkPart(2, 'PL'), part);
    part.parentNode!.removeChild(part);
    if (partList) {
      const sp = [...partList.children].find((c) => local(c) === 'score-part' && c.getAttribute('id') === pid);
      if (sp) {
        const cl = (id: string) => {
          const n = sp.cloneNode(false) as Element;
          n.setAttribute('id', id);
          return n;
        };
        partList.insertBefore(cl(`${pid}__PR`), sp);
        partList.insertBefore(cl(`${pid}__PL`), sp);
        partList.removeChild(sp);
      }
    }
  }
  return serializeMusicXmlDocument(doc);
}

function buildHitlPreview(raw: string): string {
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

function graphicFirstToken(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mn: number): string | null {
  let tok: string | null = null;
  forEachOsmdSystem(osmd, (_s, rows) => {
    for (const gm of rows[0] ?? []) {
      if (!gm || partIdFromGraphic(gm as Record<string, unknown>) !== 'P1') continue;
      if (measureMxlFromGraphic(gm as Record<string, unknown>) !== mn) continue;
      const entries = ((gm as Record<string, unknown>).staffEntries ??
        (gm as Record<string, unknown>).StaffEntries ??
        []) as unknown[];
      for (const entry of entries) {
        for (const gve of ((entry as Record<string, unknown>).graphicalVoiceEntries ??
          (entry as Record<string, unknown>).GraphicalVoiceEntries ??
          []) as unknown[]) {
          for (const note of ((gve as Record<string, unknown>).notes ??
            (gve as Record<string, unknown>).Notes ??
            []) as unknown[]) {
            const nr = note as Record<string, unknown>;
            const src = (nr.sourceNote ?? nr.SourceNote) as Record<string, unknown> | undefined;
            const p = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
            if (p) {
              tok = `fn${p.FundamentalNote}/oct${p.Octave}`;
              break;
            }
          }
          if (tok) break;
        }
        if (tok) break;
      }
    }
  });
  return tok;
}

async function runCase(label: string, hostWidth: number, autoResize: boolean, hostMinWidth?: number) {
  const host = setupDom(hostWidth);
  if (hostMinWidth != null) host.style.minWidth = `${hostMinWidth}px`;
  const xml = buildHitlPreview(readFileSync('_smoke/_raw_cheongsan.xml', 'utf8'));
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const osmd = new OpenSheetMusicDisplay(host, { autoResize, backend: 'svg' });
  await osmd.load(xml);
  osmd.zoom = 0.42;
  osmd.render();
  const g26 = graphicFirstToken(osmd, 26);
  const g27 = graphicFirstToken(osmd, 27);
  const ok = g26 != null && g27 != null && g26 !== g27 && g26.startsWith('fn5/');
  console.log(label, { hostWidth, autoResize, hostMinWidth, g26, g27, ok });
  if (!ok) throw new Error(`${label}: m26/m27 graphic shift`);
}

async function main() {
  await runCase('wide-autoresize', 1800, true);
  await runCase('narrow-autoresize', 720, true);
  await runCase('narrow-fixed-min960', 720, false, 960);
  console.log('narrow osmd ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
