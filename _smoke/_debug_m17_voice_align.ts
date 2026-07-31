/** Debug voice IDs for m17 play-order align. Run: npx tsx _smoke/_debug_m17_voice_align.ts */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import {
  collectPlayOrderAlignGroupsFromXml,
  HITL_PLAY_ORDER_ATTR,
} from '../shared/musicXmlPlayOrder';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
import { forEachGraphicalMeasure, measureMxlFromGraphic } from '../src/osmdMeasureClick';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const STEP = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function pitch(n: Element): string {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
}

function buildSlice(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  for (const measure of [...part.children]) {
    if (local(measure) !== 'measure') continue;
    for (const child of [...measure.children]) {
      if (local(child) === 'note') {
        const st = child.querySelector('staff,*|staff')?.textContent?.trim();
        if (st && st !== '1') child.remove();
      }
    }
    measure.querySelectorAll('note staff,note *|staff').forEach((el) => {
      el.textContent = '1';
    });
    pruneCrossStaffTimelineForOsmdPreview(measure, 1);
    snapshotNoteDefaultXForOsmdPreview(measure);
    reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
    normalizeMultiVoiceLayersForOsmdPreview(measure);
    realignMeasureDefaultXFromTimelineForOsmd(measure);
  }
  xml = repairTimelineForOsmdPreview(new XMLSerializer().serializeToString(doc));
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
  return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${m17.outerHTML}</part></score-partwise>`;
}

function gPitch(gn: Record<string, unknown>): string {
  const src = (gn.sourceNote ?? gn.SourceNote) as Record<string, unknown> | undefined;
  const p = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
  if (!p) return '?';
  const fn = Number(p.FundamentalNote ?? p.fundamentalNote);
  const oct = Number(p.Octave ?? p.octave);
  const acc = Number(p.Accidental ?? p.accidental);
  return `${STEP[fn] ?? '?'}${acc === -1 ? 'b' : acc === 1 ? '#' : ''}${oct}`;
}

function gVoice(gn: Record<string, unknown>): string {
  const src = (gn.sourceNote ?? gn.SourceNote) as Record<string, unknown> | undefined;
  const pve = (src?.ParentVoiceEntry ?? src?.parentVoiceEntry) as Record<string, unknown> | undefined;
  const v = (pve?.Voice ?? pve?.voice) as Record<string, unknown> | undefined;
  return String(v?.VoiceId ?? v?.voiceId ?? v?.voiceNumber ?? '?');
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const slice = buildSlice(raw);
  const doc = new DOMParser().parseFromString(slice, 'text/xml');
  console.log('XML notes:');
  for (const n of [...doc.querySelectorAll('part[id="P5"] > measure > note')]) {
    if (n.querySelector('chord,*|chord')) continue;
    console.log(' ', pitch(n as Element), 'v' + n.querySelector('voice,*|voice')?.textContent, 'po=' + n.getAttribute(HITL_PLAY_ORDER_ATTR));
  }
  console.log('groups', collectPlayOrderAlignGroupsFromXml(slice));

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, slice);
  await (osmd as { load: (x: string) => Promise<void> }).load(slice);
  (osmd as { render: () => void }).render();

  console.log('OSMD graphics before align:');
  forEachGraphicalMeasure(osmd as never, (gm) => {
    if (measureMxlFromGraphic(gm) !== 17) return;
    for (const se of ((gm as Record<string, unknown>).staffEntries ?? []) as Record<string, unknown>[]) {
      for (const gve of (se.graphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
        for (const gn of (gve.notes ?? []) as Record<string, unknown>[]) {
          const p = gPitch(gn);
          if (!['F4', 'E5', 'D5', 'F5'].includes(p)) continue;
          console.log(' ', p, 'voiceId=' + gVoice(gn));
        }
      }
    }
  });

  alignOsmdPreviewNotesByOnsetColumn(osmd as never);
  console.log('align done');
}

main().catch(console.error);
