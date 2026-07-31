import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { collectMeasureHitTargets, forEachOsmdSystem, measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1800px;height:9000px"></div></body></html>');
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

function splitGrandStaff(xml: string): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse');
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id');
    if (!pid || pid.includes('__')) continue;
    let maxStaff = 1;
    part.querySelectorAll('note staff, note *|staff').forEach((el) => {
      const n = parseInt(el.textContent?.trim() ?? '1', 10);
      if (Number.isFinite(n)) maxStaff = Math.max(maxStaff, n);
    });
    if (maxStaff < 2) continue;
    const noteStaff = (note: Element) =>
      parseInt(note.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() ?? '1', 10) || 1;
    const mk = (staffN: number, suffix: string) => {
      const p = part.cloneNode(true) as Element;
      p.setAttribute('id', `${pid}__${suffix}`);
      for (const meas of [...p.children]) {
        if (local(meas) !== 'measure') continue;
        for (const note of [...meas.querySelectorAll('note, *|note')]) {
          if (noteStaff(note) !== staffN) note.remove();
        }
        meas.querySelectorAll('note staff, note *|staff').forEach((el) => {
          el.textContent = '1';
        });
      }
      return p;
    };
    const pr = mk(1, 'PR');
    const pl = mk(2, 'PL');
    const parent = part.parentNode;
    if (parent) {
      parent.insertBefore(pr, part);
      parent.insertBefore(pl, part);
      parent.removeChild(part);
    }
    if (partList) {
      const sp = [...partList.children].find((c) => local(c) === 'score-part' && c.getAttribute('id') === pid);
      if (sp) {
        const cloneSp = (id: string) => {
          const n = sp.cloneNode(false) as Element;
          n.setAttribute('id', id);
          return n;
        };
        partList.insertBefore(cloneSp(`${pid}__PR`), sp);
        partList.insertBefore(cloneSp(`${pid}__PL`), sp);
        partList.removeChild(sp);
      }
    }
  }
  return serializeMusicXmlDocument(doc!);
}

function countStaffEntries(gm: Record<string, unknown>): number {
  const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
  return entries?.length ?? 0;
}

async function main() {
  let xml = repairTimelineForOsmdPreview(readFileSync('_smoke/_cheongsan_review.xml', 'utf8'));
  xml = splitGrandStaff(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairMissingNoteTypesForOsmdPreview(xml);

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  await osmd.load(xml);
  osmd.zoom = 0.42;
  osmd.render();

  forEachOsmdSystem(osmd, (_s, rows) => {
    const gm = rows[0]?.find((g) => measureMxlFromGraphic(g as Record<string, unknown>) === 26);
    if (!gm) return;
    const entries = countStaffEntries(gm as Record<string, unknown>);
    const bb = (gm as Record<string, unknown>).PositionAndShape ?? (gm as Record<string, unknown>).positionAndShape;
    const size = (bb as Record<string, unknown>)?.Size ?? (bb as Record<string, unknown>)?.size;
    const w = (size as Record<string, unknown>)?.width ?? (size as Record<string, unknown>)?.Width;
    console.log(`P1/st0 m26: staffEntries=${entries} graphicW=${w}`);
  });

  const targets = collectMeasureHitTargets(osmd, host);
  const m26t = targets.filter((t) => t.measureMxl === 26 && t.staffIndex === 0)[0];
  console.log('m26 click target w', m26t ? (m26t.bounds.right - m26t.bounds.left).toFixed(1) : 'NONE');

  // count note-like SVG groups near m26 x range
  if (m26t) {
    const midX = (m26t.bounds.left + m26t.bounds.right) / 2;
    let near = 0;
    host.querySelectorAll('svg *').forEach((el) => {
      if (!(el instanceof SVGGraphicsElement)) return;
      const r = el.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      const cx = r.left - hr.left + r.width / 2;
      if (Math.abs(cx - midX) < 60 && r.width > 2 && r.height > 2) near += 1;
    });
    console.log('svg elems near m26 center', near);
  }
}

void main();
