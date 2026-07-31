/**
 * Full HITL preview pipeline (shared modules only) + OSMD m26 pitch check.
 * Run: npx tsx _smoke/test_cheongsan_preview_osmd_m26.ts
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { repairTimelineForOsmdPreview, countDanglingTimelineElements } from '../shared/musicXmlTimelineCleanup.ts';
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
  const n = parseInt(st?.textContent?.trim() ?? '1', 10);
  return Number.isFinite(n) ? n : 1;
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
    if (!partId || partId.endsWith('__PR') || partId.endsWith('__PL')) continue;
    let maxStaff = 1;
    part.querySelectorAll('note staff, note *|staff').forEach((el) => {
      const n = parseInt(el.textContent?.trim() ?? '1', 10);
      if (Number.isFinite(n)) maxStaff = Math.max(maxStaff, n);
    });
    if (maxStaff < 2) continue;

    const cloneSplit = (staffN: number, suffix: string) => {
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

    const pr = cloneSplit(1, 'PR');
    const pl = cloneSplit(2, 'PL');
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
        const mk = (id: string, label: string) => {
          const n = sp.cloneNode(false) as Element;
          n.setAttribute('id', id);
          for (const ch of [...n.children]) {
            if (local(ch) === 'part-name' || local(ch) === 'part-abbreviation') ch.textContent = label;
          }
          return n;
        };
        partList.insertBefore(mk(`${partId}__PR`, 'PR'), sp);
        partList.insertBefore(mk(`${partId}__PL`, 'PL'), sp);
        partList.removeChild(sp);
      }
    }
  }
  doc.querySelectorAll('octave-shift, *|octave-shift').forEach((el) => el.remove());
  return serializeMusicXmlDocument(doc);
}

function buildPreviewXml(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  xml = repairRestDisplayForOsmdPreview(xml);
  xml = splitGrandStaff(xml);
  xml = repairTimelineForOsmdPreview(xml);
  return xml;
}

function xmlP1M26Pitches(xml: string): string[] {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) return [];
  const p1 = doc.querySelector('part[id="P1"], *|part[id="P1"]');
  if (!p1) return [];
  const m26 = [...p1.children].find(
    (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '26',
  ) as Element | undefined;
  if (!m26) return [];
  return [...m26.children]
    .filter((c) => local(c as Element) === 'note')
    .map((note) => {
      const p = (note as Element).querySelector('pitch, *|pitch');
      return p
        ? `${p.querySelector('step, *|step')?.textContent}${p.querySelector('octave, *|octave')?.textContent}`
        : 'R';
    });
}

function smPitches(osmd: import('opensheetmusicdisplay').OpenSheetMusicDisplay, mnum: number): string[] {
  const sheet = (osmd as unknown as Record<string, unknown>).Sheet as {
    SourceMeasures?: Array<Record<string, unknown>>;
    Instruments?: Array<{ IdString?: string }>;
  };
  const out: string[] = [];
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  for (const sm of sheet?.SourceMeasures ?? []) {
    const num = Number(sm.MeasureNumberXML ?? sm.MeasureNumber ?? 0);
    if (num !== mnum) continue;
    for (const c of (sm.VerticalSourceStaffEntryContainers as unknown[]) ?? []) {
      const rec = c as Record<string, unknown>;
      for (const se of (rec.StaffEntries as unknown[]) ?? []) {
        if (!se) continue;
        for (const ve of ((se as Record<string, unknown>).VoiceEntries as unknown[]) ?? []) {
          for (const note of ((ve as Record<string, unknown>).Notes as unknown[]) ?? []) {
            const p = (note as Record<string, unknown>).Pitch as Record<string, unknown> | undefined;
            if (!p) continue;
            const step = steps[Number(p.FundamentalNote ?? 0)] ?? '?';
            out.push(step + String(p.Octave ?? ''));
          }
        }
      }
    }
  }
  return out;
}

async function main() {
  const raw = readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const preview = buildPreviewXml(raw);
  console.log('dangling', countDanglingTimelineElements(preview));
  console.log('xml P1 m26', xmlP1M26Pitches(preview));
  if (/<print[\s>]/i.test(preview)) throw new Error('preview still has <print>');

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.getElementById('host') as HTMLDivElement;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawMeasureNumbers: false,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);

  try {
    await osmd.load(preview);
  } catch (e) {
    console.warn('full 6-part load failed, trying P1+P2+P3', e instanceof Error ? e.message : e);
    const doc = parseMusicXmlDocument(preview);
    if (!doc) throw e;
    for (const part of [...doc.querySelectorAll('part, *|part')]) {
      const id = part.getAttribute('id') ?? '';
      if (!['P1', 'P2', 'P3'].includes(id)) part.parentNode?.removeChild(part);
    }
    const pl = [...doc.documentElement.children].find((c) => local(c) === 'part-list');
    if (pl) {
      for (const sp of [...pl.children]) {
        if (local(sp) === 'score-part' && !['P1', 'P2', 'P3'].includes(sp.getAttribute('id') ?? '')) {
          pl.removeChild(sp);
        }
      }
    }
    await osmd.load(serializeMusicXmlDocument(doc));
  }

  osmd.render();
  const m26 = smPitches(osmd, 26);
  const m27 = smPitches(osmd, 27);
  console.log('OSMD m26 pitches (all parts)', m26.slice(0, 15));
  console.log('OSMD m27 pitches (all parts)', m27.slice(0, 15));

  if (!m26.some((p) => p.startsWith('F5'))) {
    throw new Error(`OSMD m26 missing F5 — got ${JSON.stringify(m26)}`);
  }
  if (m26.some((p) => p.startsWith('B4')) && !m27.some((p) => p.startsWith('B4'))) {
    throw new Error('OSMD m26 contains B4 but m27 does not — measure shift');
  }
  console.log('cheongsan preview osmd m26 ok');
}

void main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
