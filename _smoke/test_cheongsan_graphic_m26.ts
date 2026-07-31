/**
 * Graphic measure numbers st0 around m25-27 (full preview pipeline).
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { forEachOsmdSystem, measureMxlFromGraphic } from '../src/osmdMeasureClick.ts';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
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

function splitGrandStaff(xml: string): string {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('parse');
  const root = doc.documentElement;
  const partList = [...root.children].find((c) => local(c) === 'part-list');
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const partId = part.getAttribute('id');
    if (!partId || partId.includes('__')) continue;
    let maxStaff = 1;
    part.querySelectorAll('note staff, note *|staff').forEach((el) => {
      const n = parseInt(el.textContent?.trim() ?? '1', 10);
      if (Number.isFinite(n)) maxStaff = Math.max(maxStaff, n);
    });
    if (maxStaff < 2) continue;
    const mk = (staffN: number, suffix: string) => {
      const p = part.cloneNode(true) as Element;
      p.setAttribute('id', `${partId}__${suffix}`);
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
      const sp = [...partList.children].find(
        (c) => local(c) === 'score-part' && c.getAttribute('id') === partId,
      );
      if (sp) {
        const cloneSp = (id: string, label: string) => {
          const n = sp.cloneNode(false) as Element;
          n.setAttribute('id', id);
          for (const ch of [...n.children]) {
            if (local(ch) === 'part-name' || local(ch) === 'part-abbreviation') ch.textContent = label;
          }
          return n;
        };
        partList.insertBefore(cloneSp(`${partId}__PR`, 'PR'), sp);
        partList.insertBefore(cloneSp(`${partId}__PL`, 'PL'), sp);
        partList.removeChild(sp);
      }
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

function buildPreview(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = splitGrandStaff(xml);
  xml = repairTimelineForOsmdPreview(xml);
  return xml;
}

async function dumpGraphic(label: string, xml: string) {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  try {
    await osmd.load(xml);
  } catch (e) {
    console.log(label, 'LOAD FAIL', e instanceof Error ? e.message : e);
    return;
  }
  osmd.render();
  console.log('\n' + label);
  forEachOsmdSystem(osmd, (_sys, rows) => {
    for (let si = 0; si < Math.min(rows.length, 7); si++) {
      const nums: number[] = [];
      for (let mi = 0; mi < rows[si]!.length; mi++) {
        const gm = rows[si]![mi] as Record<string, unknown>;
        const n = measureMxlFromGraphic(gm);
        if (n != null && n >= 23 && n <= 29) nums.push(n);
      }
      if (nums.length) console.log(` staff${si}`, nums.join(','));
    }
  });
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const preview = buildPreview(raw);

  const docP1 = parseMusicXmlDocument(preview);
  if (docP1) {
    for (const part of [...docP1.querySelectorAll('part, *|part')]) {
      if (part.getAttribute('id') !== 'P1') part.parentNode?.removeChild(part);
    }
    await dumpGraphic('P1 only', serializeMusicXmlDocument(docP1));
  }

  await dumpGraphic('6-part preview', preview);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
