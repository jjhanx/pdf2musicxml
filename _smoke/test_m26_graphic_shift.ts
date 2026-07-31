/**
 * Detect visual m26→m27 column shift (P1 first pitch in graphic vs source).
 * Run: npx tsx _smoke/test_m26_graphic_shift.ts [xmlPath]
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { measureMxlFromGraphic, forEachOsmdSystem, partIdFromGraphic } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="host" style="width:720px;height:14000px"></div></body></html>',
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

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function noteStaff(note: Element): number {
  return parseInt(note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() ?? '1', 10) || 1;
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
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse');
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id');
    if (!pid || pid.includes('__')) continue;
    let max = 1;
    part.querySelectorAll('note staff, note *|staff').forEach((s) => {
      max = Math.max(max, parseInt(s.textContent ?? '1', 10));
    });
    if (max < 2) continue;
    const mk = (sn: number, suf: string) => {
      const p = part.cloneNode(true) as Element;
      p.setAttribute('id', `${pid}__${suf}`);
      for (const m of [...p.children]) {
        if (local(m) !== 'measure') continue;
        for (const n of [...m.querySelectorAll('note')]) if (noteStaff(n) !== sn) n.remove();
        m.querySelectorAll('note staff, note *|staff').forEach((s) => {
          s.textContent = '1';
        });
        pruneCrossStaffTimeline(m, sn);
      }
      return p;
    };
    part.parentNode!.insertBefore(mk(1, 'PR'), part);
    part.parentNode!.insertBefore(mk(2, 'PL'), part);
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

function xmlP1FirstPitch(raw: string, mn: number): string | null {
  const doc = parseMusicXmlDocument(raw);
  if (!doc) return null;
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    if (part.getAttribute('id') !== 'P1') continue;
    for (const meas of [...part.children]) {
      if (local(meas) !== 'measure' || meas.getAttribute('number') !== String(mn)) continue;
      for (const n of [...meas.children]) {
        if (local(n) !== 'note') continue;
        const p = n.querySelector(':scope > pitch, :scope > *|pitch');
        if (!p) continue;
        const step = p.querySelector(':scope > step, :scope > *|step')?.textContent ?? '';
        const oct = p.querySelector(':scope > octave, :scope > *|octave')?.textContent ?? '';
        return `${step}${oct}`;
      }
    }
  }
  return null;
}

function osmdPitchToken(p: Record<string, unknown>): string {
  const fn = p.FundamentalNote ?? p.fundamentalNote;
  const oct = p.Octave ?? p.octave;
  return `fn${fn}/oct${oct}`;
}

function pitchTokenToLabel(tok: string): string | null {
  const m = /^fn(\d+)\/oct(\d+)$/.exec(tok);
  if (!m) return null;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[Number(m[1])] ?? '?'}${m[2]}`;
}

function graphicFirstPitch(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, pid: string, mn: number): string | null {
  let tok: string | null = null;
  forEachOsmdSystem(osmd, (_s, rows) => {
    for (const gm of rows[0] ?? []) {
      if (!gm || partIdFromGraphic(gm as Record<string, unknown>) !== pid) continue;
      if (measureMxlFromGraphic(gm as Record<string, unknown>) !== mn) continue;
      for (const entry of ((gm as Record<string, unknown>).staffEntries ??
        (gm as Record<string, unknown>).StaffEntries ??
        []) as unknown[]) {
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
              tok = osmdPitchToken(p);
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

function graphicWidth(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, pid: string, mn: number): number {
  let w = 0;
  forEachOsmdSystem(osmd, (_s, rows) => {
    for (const gm of rows[0] ?? []) {
      if (!gm || partIdFromGraphic(gm as Record<string, unknown>) !== pid) continue;
      if (measureMxlFromGraphic(gm as Record<string, unknown>) !== mn) continue;
      const bb = (gm as Record<string, unknown>).PositionAndShape ?? (gm as Record<string, unknown>).positionAndShape;
      const size = (bb as Record<string, unknown>)?.Size ?? (bb as Record<string, unknown>)?.size;
      const width = (size as Record<string, unknown>)?.width ?? (size as Record<string, unknown>)?.Width;
      if (typeof width === 'number') w = Math.max(w, width);
    }
  });
  return w;
}

async function check(label: string, xmlPath: string, opts?: { hostWidth?: number; autoResize?: boolean }) {
  const raw = readFileSync(xmlPath, 'utf8');
  const xml = buildPreview(raw);
  const xml26 = xmlP1FirstPitch(raw, 26);
  const xml27 = xmlP1FirstPitch(raw, 27);
  const hostWidth = opts?.hostWidth ?? 720;
  const autoResize = opts?.autoResize ?? true;
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body><div id="host" style="width:${hostWidth}px;height:14000px"></div></body></html>`,
  );
  (globalThis as Record<string, unknown>).document = dom.window.document;
  (globalThis as Record<string, unknown>).window = dom.window;
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = dom.window.document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize, backend: 'svg' });
  await osmd.load(xml);
  osmd.zoom = 0.42;
  osmd.render();
  const g26tok = graphicFirstPitch(osmd, 'P1', 26);
  const g27tok = graphicFirstPitch(osmd, 'P1', 27);
  const g26 = g26tok ? pitchTokenToLabel(g26tok) : null;
  const g27 = g27tok ? pitchTokenToLabel(g27tok) : null;
  const w26 = graphicWidth(osmd, 'P1', 26);
  const shifted = g26 != null && g27 != null && g26 === g27;
  const m27in26 = xml26 != null && g26 != null && xml27 != null && g26 === xml27 && g26 !== xml26;
  console.log(label, { xml26, xml27, g26, g27, w26, shifted, m27in26 });
  if (shifted || m27in26 || w26 <= 0) {
    throw new Error(`${label}: m26/m27 graphic shift (w26=${w26}, g26=${g26}, xml26=${xml26}, xml27=${xml27})`);
  }
}

async function main() {
  const path = process.argv[2] ?? '_smoke/_raw_cheongsan.xml';
  await check('wide-1800', path, { hostWidth: 1800, autoResize: true });
  await check('narrow-fixed', path, { hostWidth: 720, autoResize: false });
  console.log('graphic shift ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
