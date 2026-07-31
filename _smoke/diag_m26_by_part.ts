import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1600px;height:8000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

function local(el: Element) { return el.localName?.toLowerCase() ?? el.tagName.toLowerCase(); }
function noteStaff(n: Element) { return parseInt(n.querySelector(':scope > staff')?.textContent?.trim() ?? '1', 10) || 1; }

function pruneCrossStaffTimeline(measure: Element, staffN: number): void {
  for (const child of [...measure.children]) {
    const tag = local(child);
    if (tag !== 'backup' && tag !== 'forward') continue;
    const idx = [...measure.children].indexOf(child);
    let prevStaff: number | null = null;
    for (let j = idx - 1; j >= 0; j--) if (local(measure.children[j]!) === 'note') { prevStaff = noteStaff(measure.children[j] as Element); break; }
    let nextStaff: number | null = null;
    for (let j = idx + 1; j < measure.children.length; j++) if (local(measure.children[j]!) === 'note') { nextStaff = noteStaff(measure.children[j] as Element); break; }
    if (nextStaff !== staffN) child.remove();
    else if (prevStaff === null || prevStaff !== staffN) child.remove();
  }
}

function splitGrandStaff(xml: string): string {
  const doc = parseMusicXmlDocument(xml)!;
  const partList = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
  for (const part of [...doc.querySelectorAll('part')]) {
    const pid = part.getAttribute('id');
    if (!pid || pid.includes('__')) continue;
    let max = 1;
    part.querySelectorAll('note staff').forEach((s) => { max = Math.max(max, parseInt(s.textContent ?? '1', 10)); });
    if (max < 2) continue;
    const mk = (sn: number, suf: string) => {
      const p = part.cloneNode(true) as Element;
      p.setAttribute('id', `${pid}__${suf}`);
      for (const m of [...p.children]) {
        if (local(m) !== 'measure') continue;
        for (const n of [...m.querySelectorAll('note')]) if (noteStaff(n) !== sn) n.remove();
        m.querySelectorAll('note staff').forEach((s) => { s.textContent = '1'; });
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
        const clone = (id: string) => { const n = sp.cloneNode(false) as Element; n.setAttribute('id', id); return n; };
        partList.insertBefore(clone(`${pid}__PR`), sp);
        partList.insertBefore(clone(`${pid}__PL`), sp);
        partList.removeChild(sp);
      }
    }
  }
  doc.querySelectorAll('octave-shift').forEach((e) => e.remove());
  return serializeMusicXmlDocument(doc);
}

function buildPreview(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = splitGrandStaff(xml);
  return repairTimelineForOsmdPreview(xml);
}

const STEPS = ['C','D','E','F','G','A','B'];

async function main() {
  const preview = buildPreview(readFileSync('_smoke/_cheongsan_review.xml', 'utf8'));
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const osmd = new OpenSheetMusicDisplay(document.getElementById('host')!, { backend: 'svg' });
  await osmd.load(preview);
  osmd.render();
  const sheet = (osmd as unknown as { Sheet?: Record<string, unknown> }).Sheet!;
  const instruments = (sheet.Instruments as Array<{ IdString?: string; Name?: string }>) ?? [];
  console.log('instruments', instruments.map((i, idx) => `${idx}:${i.IdString}`).join(', '));

  for (const mn of [25, 26, 27]) {
    console.log(`\n=== MXL m${mn} ===`);
    for (const sm of (sheet.SourceMeasures as Array<Record<string, unknown>>) ?? []) {
      if (Number(sm.MeasureNumberXML ?? sm.MeasureNumber) !== mn) continue;
      for (const c of (sm.VerticalSourceStaffEntryContainers as Array<Record<string, unknown>>) ?? []) {
        for (let si = 0; si < ((c.StaffEntries as unknown[]) ?? []).length; si++) {
          const se = (c.StaffEntries as Array<Record<string, unknown>>)[si];
          if (!se) continue;
          const inst = se.ParentStaff as Record<string, unknown> | undefined;
          const instr = inst?.ParentInstrument as Record<string, unknown> | undefined;
          const pid = String(instr?.IdString ?? instr?.idString ?? `st${si}`);
          for (const ve of (se.VoiceEntries as Array<Record<string, unknown>>) ?? []) {
            for (const n of (ve.Notes as Array<Record<string, unknown>>) ?? []) {
              const p = n.Pitch as Record<string, unknown> | undefined;
              const name = p ? `${STEPS[Number(p.FundamentalNote)]}${p.Octave}` : 'rest';
              console.log(`  ${pid} st${si}: ${name}`);
            }
          }
        }
      }
    }
  }
}
void main();
