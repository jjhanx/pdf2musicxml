import { readFileSync, writeFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview, countDanglingTimelineElements } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}

function noteStaff(n: Element): number {
  return parseInt(n.querySelector(':scope > staff, :scope > *|staff')?.textContent?.trim() ?? '1', 10) || 1;
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
        for (const n of [...m.querySelectorAll('note, *|note')]) {
          if (noteStaff(n) !== sn) n.remove();
        }
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

let xml = repairTimelineForOsmdPreview(readFileSync('_smoke/_cheongsan_review.xml', 'utf8'));
console.log('after timeline1 dangling', countDanglingTimelineElements(xml));
xml = repairRestDisplayForOsmdPreview(xml);
xml = splitGrandStaff(xml);
xml = repairTimelineForOsmdPreview(xml);
console.log('after split dangling', countDanglingTimelineElements(xml));
writeFileSync('_smoke/_preview_pipeline.xml', xml, 'utf8');

const doc = parseMusicXmlDocument(xml)!;
const p1 = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === 'P1');
for (const mnum of [25, 26, 27]) {
  const m = [...p1!.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === String(mnum))!;
  const tags = [...m.children].map((c) => {
    const t = local(c);
    if (t === 'note') {
      return `N:${c.querySelector('pitch step, *|step')?.textContent}${c.querySelector('pitch octave, *|octave')?.textContent}`;
    }
    if (t === 'backup' || t === 'forward') {
      return `${t}(${c.querySelector('duration, *|duration')?.textContent})`;
    }
    return t;
  });
  console.log(`P1 m${mnum}`, tags.join('|'));
}

for (const pid of ['P5__PL']) {
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === pid);
  const m = [...part!.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '26')!;
  const tags = [...m.children].map((c) => {
    const t = local(c);
    if (t === 'note') {
      return `N:${c.querySelector('pitch step, *|step')?.textContent}${c.querySelector('pitch octave, *|octave')?.textContent}`;
    }
    if (t === 'backup' || t === 'forward') return `${t}(${c.querySelector('duration, *|duration')?.textContent})`;
    return t;
  });
  console.log(`${pid} m26`, tags.join('|'));
}
