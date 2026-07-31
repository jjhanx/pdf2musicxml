import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width:1600px;height:5000px"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document, window: dom.window, DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

const NAMES = ['C','D','E','F','G','A','B'];

function prep(partId: string, split: boolean): string {
  let xml = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  xml = repairTimelineForOsmdPreview(xml);
  if (split) {
    // minimal split P5 only
    const doc = parseMusicXmlDocument(xml)!;
    const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
    const p5 = [...doc.querySelectorAll('part')].find(p => p.getAttribute('id') === 'P5')!;
    const pr = p5.cloneNode(true) as Element; pr.setAttribute('id','P5__PR');
    const pl = p5.cloneNode(true) as Element; pl.setAttribute('id','P5__PL');
    for (const m of [...pr.children]) for (const n of [...m.querySelectorAll('note')]) {
      const st = parseInt(n.querySelector('staff')?.textContent ?? '1',10);
      if (st !== 1) n.remove();
    }
    for (const m of [...pl.children]) for (const n of [...m.querySelectorAll('note')]) {
      const st = parseInt(n.querySelector('staff')?.textContent ?? '1',10);
      if (st !== 2) n.remove();
    }
    p5.parentNode!.insertBefore(pr,p5); p5.parentNode!.insertBefore(pl,p5); p5.parentNode!.removeChild(p5);
    xml = serializeMusicXmlDocument(doc);
    xml = repairTimelineForOsmdPreview(xml);
  }
  xml = repairUnderfullMeasuresForOsmdPreview(xml);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = repairMissingNoteTypesForOsmdPreview(xml);
  const doc2 = parseMusicXmlDocument(xml)!;
  for (const p of [...doc2.querySelectorAll('part')]) {
    if (p.getAttribute('id') !== partId) p.parentNode?.removeChild(p);
    else for (const c of [...p.children]) if (c.getAttribute('number') && parseInt(c.getAttribute('number')!,10) > 28) p.removeChild(c);
  }
  doc2.querySelectorAll('octave-shift').forEach(e => e.remove());
  return serializeMusicXmlDocument(doc2);
}

function readPitch(n: Record<string, unknown>): string {
  const p = n.Pitch as Record<string, unknown> | undefined;
  if (!p) return 'rest';
  const fn = Number(p.FundamentalNote ?? p.fundamentalNote);
  const oct = Number(p.Octave ?? p.octave);
  const acc = Number(p.Accidental ?? p.accidental ?? 0);
  const name = NAMES[fn] ?? String(fn);
  return `${name}${acc < 0 ? 'b' : acc > 0 ? '#' : ''}${oct}`;
}

function dumpSource(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mn: number) {
  const sheet = (osmd as unknown as { Sheet?: { SourceMeasures?: Array<Record<string, unknown>> } }).Sheet;
  for (const sm of sheet?.SourceMeasures ?? []) {
    if (Number(sm.MeasureNumberXML ?? sm.MeasureNumber) !== mn) continue;
    const notes: string[] = [];
    for (const c of (sm.VerticalSourceStaffEntryContainers as Array<Record<string, unknown>>) ?? []) {
      for (const se of (c.StaffEntries as Array<Record<string, unknown>>) ?? []) {
        if (!se) continue;
        for (const ve of (se.VoiceEntries as Array<Record<string, unknown>>) ?? []) {
          for (const n of (ve.Notes as Array<Record<string, unknown>>) ?? []) notes.push(readPitch(n));
        }
      }
    }
    console.log('  source', notes.slice(0,6).join(', '));
  }
}

async function run(label: string, xml: string) {
  console.log('\n'+label);
  const doc = parseMusicXmlDocument(xml)!;
  const m26 = [...doc.querySelectorAll('measure[number="26"] note')][0];
  const step = m26?.querySelector('pitch step')?.textContent;
  const oct = m26?.querySelector('pitch octave')?.textContent;
  console.log('  XML m26 first', step, oct);
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host')!; host.innerHTML='';
  const osmd = new OpenSheetMusicDisplay(host, { autoResize: true, backend: 'svg' });
  try {
    await osmd.load(xml);
    osmd.render();
    dumpSource(osmd, 26);
    dumpSource(osmd, 27);
  } catch (e) {
    console.log('  LOAD FAIL', e instanceof Error ? e.message : e);
  }
}

async function main() {
  await run('P1 no split', prep('P1', false));
  await run('P1 with P5 split in score', prep('P1', true));
}
void main();
