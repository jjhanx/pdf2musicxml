/** P5__PL m26 after split + sanitize — voice timeline + OSMD m26 graphic width */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import {
  repairTimelineForOsmdPreview,
  countDanglingTimelineElements,
} from '../shared/musicXmlTimelineCleanup.ts';
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { forEachOsmdSystem, measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:8000px"></div></body></html>');
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
  const st = note.querySelector(':scope > staff, :scope > *|staff');
  return parseInt(st?.textContent?.trim() ?? '1', 10) || 1;
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
    if (nextStaff !== staffN) {
      child.remove();
      continue;
    }
    if (prevStaff === null || prevStaff !== staffN) child.remove();
  }
}

function splitP5(xml: string): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse');
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  const p5 = doc.querySelector('part[id="P5"], *|part[id="P5"]');
  if (!p5) return xml;
  const clone = (staffN: number, suffix: string) => {
    const p = p5.cloneNode(true) as Element;
    p.setAttribute('id', `P5__${suffix}`);
    for (const meas of [...p.children]) {
      if (local(meas) !== 'measure') continue;
      for (const note of [...meas.querySelectorAll('note, *|note')]) {
        if (noteStaff(note) !== staffN) note.remove();
      }
      meas.querySelectorAll('note staff, note *|staff').forEach((el) => {
        el.textContent = '1';
      });
      pruneCrossStaffTimeline(meas, staffN);
    }
    return p;
  };
  const pr = clone(1, 'PR');
  const pl = clone(2, 'PL');
  const parent = p5.parentNode;
  if (parent) {
    parent.insertBefore(pr, p5);
    parent.insertBefore(pl, p5);
    parent.removeChild(p5);
  }
  if (partList) {
    const sp = [...partList.children].find((c) => local(c) === 'score-part' && c.getAttribute('id') === 'P5');
    if (sp) {
      const mk = (id: string) => {
        const n = sp.cloneNode(false) as Element;
        n.setAttribute('id', id);
        return n;
      };
      partList.insertBefore(mk('P5__PR'), sp);
      partList.insertBefore(mk('P5__PL'), sp);
      partList.removeChild(sp);
    }
  }
  return serializeMusicXmlDocument(doc);
}

function plM26Summary(xml: string): string {
  const doc = parseMusicXmlDocument(xml);
  const pl = doc?.querySelector('part[id="P5__PL"], *|part[id="P5__PL"]');
  const m = pl && [...pl.children].find((c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '26');
  if (!m) return 'no m26';
  const parts: string[] = [];
  let dur = 0;
  for (const c of [...m.children]) {
    const tag = local(c as Element);
    if (tag === 'note') {
      const d = parseInt((c as Element).querySelector('duration, *|duration')?.textContent ?? '0', 10);
      if (!(c as Element).querySelector('chord, *|chord')) dur += d;
      const typ = (c as Element).querySelector('type, *|type')?.textContent ?? '?';
      parts.push(`${typ}(${d})`);
    } else if (tag === 'backup' || tag === 'forward') {
      parts.push(tag);
    }
  }
  return `dur=${dur} [${parts.join(', ')}]`;
}

async function main() {
  let xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  xml = splitP5(xml);
  console.log('PL m26 before cleanup', plM26Summary(xml), 'dangling', countDanglingTimelineElements(xml));
  xml = repairMissingNoteTypesForOsmdPreview(repairTimelineForOsmdPreview(xml));
  console.log('PL m26 after cleanup', plM26Summary(xml), 'dangling', countDanglingTimelineElements(xml));

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.zoom = 0.45;
  osmd.render();

  const hits: string[] = [];
  forEachOsmdSystem(osmd, (_s, rows) => {
    for (let si = 0; si < rows.length; si++) {
      for (const gm of rows[si] ?? []) {
        const n = measureMxlFromGraphic(gm as Record<string, unknown>);
        if (n !== 26) continue;
        const bb = (gm as Record<string, unknown>).PositionAndShape ?? (gm as Record<string, unknown>).positionAndShape;
        const size = (bb as Record<string, unknown>)?.Size ?? (bb as Record<string, unknown>)?.size;
        const w = (size as Record<string, unknown>)?.width ?? (size as Record<string, unknown>)?.Width;
        hits.push(`st${si}:w=${String(w)}`);
      }
    }
  });
  console.log('graphic m26', hits.join(' | ') || 'NONE');
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
