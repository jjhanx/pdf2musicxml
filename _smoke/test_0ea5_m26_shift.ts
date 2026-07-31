/**
 * 0ea5 review.mxl — full preview sanitize + OSMD measure shift check
 * m26 column must show F5 (P1), not B4 (P1 m27)
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  removeDanglingTimelineElementsForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';
import { repairMissingNoteTypesForOsmdPreview, repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { collectMeasureHitTargets, forEachOsmdSystem, measureMxlFromGraphic, partIdFromGraphic } from '../src/osmdMeasureClick.ts';

function firstPitchFromGraphic(gm: Record<string, unknown>): string | null {
  const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
  for (const entry of entries ?? []) {
    const er = entry as Record<string, unknown>;
    const gves = (er.graphicalVoiceEntries ?? er.GraphicalVoiceEntries) as unknown[] | undefined;
    for (const gve of gves ?? []) {
      const gr = gve as Record<string, unknown>;
      const notes = (gr.notes ?? gr.Notes) as unknown[] | undefined;
      for (const note of notes ?? []) {
        const nr = note as Record<string, unknown>;
        const src = (nr.sourceNote ?? nr.SourceNote) as Record<string, unknown> | undefined;
        const pitch = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
        if (!pitch) continue;
        const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const fn = pitch.FundamentalNote ?? pitch.fundamentalNote;
        const oct = pitch.Octave ?? pitch.octave;
        if (typeof fn === 'number' && typeof oct === 'number') return `${names[fn] ?? fn}${oct}`;
      }
    }
  }
  return null;
}

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:12000px"></div></body></html>');
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

function loadReviewXml(): string {
  return readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
}

function noteStaff(note: Element): number {
  return parseInt(note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() ?? '1', 10) || 1;
}

function maxStavesInPart(part: Element): number {
  let max = 1;
  part.querySelectorAll('note staff, note *|staff').forEach((el) => {
    const n = parseInt(el.textContent?.trim() ?? '1', 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  });
  return max;
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
    if (nextStaff !== staffN) child.remove();
    else if (prevStaff === null || prevStaff !== staffN) child.remove();
  }
}

function transformPartToSingleStaff(part: Element, staffN: number): void {
  for (const meas of [...part.children]) {
    if (local(meas) !== 'measure') continue;
    for (const note of [...meas.querySelectorAll('note, *|note')]) {
      if (noteStaff(note) !== staffN) note.remove();
    }
    meas.querySelectorAll('note staff, note *|staff').forEach((el) => {
      el.textContent = '1';
    });
    pruneCrossStaffTimeline(meas, staffN);
  }
}

function splitGrandStaff(xml: string): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse');
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id');
    if (!pid || pid.includes('__')) continue;
    if (maxStavesInPart(part) < 2) continue;
    const pr = part.cloneNode(true) as Element;
    const pl = part.cloneNode(true) as Element;
    pr.setAttribute('id', `${pid}__PR`);
    pl.setAttribute('id', `${pid}__PL`);
    transformPartToSingleStaff(pr, 1);
    transformPartToSingleStaff(pl, 2);
    const parent = part.parentNode;
    if (parent) {
      parent.insertBefore(pr, part);
      parent.insertBefore(pl, part);
      parent.removeChild(part);
    }
    if (partList) {
      const sp = [...partList.children].find((c) => local(c) === 'score-part' && c.getAttribute('id') === pid);
      if (sp) {
        const mk = (id: string) => {
          const n = sp.cloneNode(false) as Element;
          n.setAttribute('id', id);
          return n;
        };
        partList.insertBefore(mk(`${pid}__PR`), sp);
        partList.insertBefore(mk(`${pid}__PL`), sp);
        partList.removeChild(sp);
      }
    }
  }
  return serializeMusicXmlDocument(doc);
}

function sanitizeForOsmd(xml: string): string {
  let out = repairRestDisplayForOsmdPreview(xml);
  out = repairMissingNoteTypesForOsmdPreview(out);
  out = repairTimelineForOsmdPreview(out);
  out = repairUnderfullMeasuresForOsmdPreview(out);
  const doc = parseMusicXmlDocument(out);
  if (doc) {
    doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  }
  return doc ? serializeMusicXmlDocument(doc) : out;
}

function buildPreviewXml(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  xml = splitGrandStaff(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  return sanitizeForOsmd(xml);
}

function findGraphicMeasure(osmd: unknown, measureMxl: number, staffIndex: number): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  forEachOsmdSystem(osmd as import('opensheetmusicdisplay').OpenSheetMusicDisplay, (_s, rows) => {
    const gm = rows[staffIndex]?.find((g) => measureMxlFromGraphic(g as Record<string, unknown>) === measureMxl);
    if (gm) found = gm as Record<string, unknown>;
  });
  return found;
}

async function runPipeline(label: string, buildFn: (raw: string) => string) {
  const raw = loadReviewXml();
  const xml = buildFn(raw);
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(xml);
  osmd.zoom = 0.42;
  osmd.render();

  for (let si = 0; si < 7; si++) {
    for (const mn of [25, 26, 27]) {
      const gm = findGraphicMeasure(osmd, mn, si);
      if (!gm) continue;
      const pid = partIdFromGraphic(gm);
      const ps = firstPitchFromGraphic(gm);
      console.log(`${label} st${si} ${pid} m${mn} first=${ps}`);
    }
  }

  const gm26 = findGraphicMeasure(osmd, 26, 0);
  const gm27 = findGraphicMeasure(osmd, 27, 0);
  const p26 = gm26 ? firstPitchFromGraphic(gm26) : null;
  const p27 = gm27 ? firstPitchFromGraphic(gm27) : null;
  const targets = collectMeasureHitTargets(osmd, host);
  const m26hits = targets.filter((t) => t.measureMxl === 26).length;
  console.log(label, 'summary', { p26, p27, m26hits });
  return { p26, p27, m26hits };
}

async function main() {
  const raw = loadReviewXml();
  const xml = buildPreviewXml(raw);
  const doc = parseMusicXmlDocument(xml)!;
  for (const pid of ['P1', 'P5__PL']) {
    const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === pid);
    const m = part && [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '26');
    const step = m?.querySelector('note pitch step')?.textContent;
    const oct = m?.querySelector('note pitch octave')?.textContent;
    console.log('XML', pid, 'm26 first note', step, oct);
  }

  const cleaned = await runPipeline('WITH cleanup', buildPreviewXml);
  if (cleaned.p26 !== 'F5') throw new Error(`WITH cleanup: m26 pitch ${cleaned.p26} expected F5`);
  if (cleaned.m26hits === 0) throw new Error('WITH cleanup: no m26 click targets');

  // NO timeline cleanup — orphan backup + print remain (reproduces shift?)
  const rawOnly = await runPipeline('NO cleanup', (raw) => {
    let xml = splitGrandStaff(raw);
    xml = repairRestDisplayForOsmdPreview(xml);
    xml = repairMissingNoteTypesForOsmdPreview(xml);
    return xml;
  });
  console.log('comparison', { cleaned, rawOnly });
  console.log('ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
