/** Full score m26 graphic width after HITL preview sanitize chain */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';
import { forEachOsmdSystem, measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';

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
    if (nextStaff !== staffN) child.remove();
    else if (prevStaff === null || prevStaff !== staffN) child.remove();
  }
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
        pruneCrossStaffTimeline(meas, staffN);
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
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

function readWidth(gm: Record<string, unknown>): number {
  const bb = gm.PositionAndShape ?? gm.positionAndShape;
  const rec = bb as Record<string, unknown> | undefined;
  const size = rec?.Size ?? rec?.size;
  const srec = size as Record<string, unknown> | undefined;
  const w = srec?.width ?? srec?.Width;
  return typeof w === 'number' ? w : Number(w) || 0;
}

async function main() {
  let xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  xml = repairTimelineForOsmdPreview(xml);
  xml = splitGrandStaff(xml);
  xml = repairTimelineForOsmdPreview(xml);
  xml = repairMissingNoteTypesForOsmdPreview(xml);

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.zoom = 0.42;
  osmd.render();

  const rows: string[] = [];
  forEachOsmdSystem(osmd, (_s, rws) => {
    for (let si = 0; si < rws.length; si++) {
      for (const gm of rws[si] ?? []) {
        const n = measureMxlFromGraphic(gm as Record<string, unknown>);
        if (n !== 26) continue;
        rows.push(`st${si}:w=${readWidth(gm as Record<string, unknown>).toFixed(2)}`);
      }
    }
  });
  console.log('m26 widths', rows.join(' | ') || 'NONE');
  const bad = rows.filter((r) => r.includes('w=-') || r.includes('w=0'));
  if (bad.length) throw new Error(`negative/zero m26 width: ${bad.join(', ')}`);
  console.log('ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
