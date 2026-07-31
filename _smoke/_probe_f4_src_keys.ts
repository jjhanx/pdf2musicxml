import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  stripDefaultXyKeepLayoutAttrsForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';
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
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function buildPreview(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  for (const part of [...doc.querySelectorAll('part,*|part')]) {
    if (part.getAttribute('id') !== 'P5') part.remove();
  }
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
  xml = new XMLSerializer().serializeToString(doc);
  xml = repairMissingNoteTypesForOsmdPreview(xml);
  return stripDefaultXyKeepLayoutAttrsForOsmdPreview(xml);
}

async function main() {
  const raw = execSync('python _smoke/_export_m17_play_order_234.py', {
    encoding: 'utf8',
    maxBuffer: 30e6,
  });
  const xml = buildPreview(raw);
  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: false, backend: 'svg', drawMeasureNumbers: false });
  await (osmd as { load: (x: string) => Promise<void> }).load(xml);
  (osmd as { render: () => void }).render();

  forEachGraphicalMeasure(osmd as never, (gm) => {
    if (measureMxlFromGraphic(gm) !== 17) return;
    const gmR = gm as Record<string, unknown>;
    for (const se of (gmR.staffEntries ?? gmR.StaffEntries ?? []) as unknown[]) {
      const seR = se as Record<string, unknown>;
      for (const gve of (seR.graphicalVoiceEntries ?? seR.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gveR = gve as Record<string, unknown>;
        const ts = gveR.parentVoiceEntry ?? gveR.ParentVoiceEntry;
        const tsR = ts as Record<string, unknown> | undefined;
        const timestamp = tsR?.Timestamp ?? tsR?.timestamp;
        for (const gn of (gveR.notes ?? gveR.Notes ?? []) as unknown[]) {
          const gnR = gn as Record<string, unknown>;
          const vfp = gnR.vfpitch ?? gnR.vfPitch;
          const rawP = Array.isArray(vfp) ? vfp[0] : vfp;
          if (typeof rawP !== 'string' || !/^f4/i.test(rawP)) continue;
          const src = (gnR.sourceNote ?? gnR.SourceNote) as Record<string, unknown>;
          const pv = (src?.ParentVoiceEntry ?? src?.parentVoiceEntry) as Record<string, unknown>;
          const voice = (pv?.ParentVoice ?? pv?.parentVoice) as Record<string, unknown>;
          const vid = voice?.VoiceId ?? voice?.voiceId;
          if (vid !== 2 && vid !== '2') continue;
          console.log('F4 v2 src keys:', Object.keys(src ?? {}));
          console.log('  attrs:', (src as { noteAttributes?: unknown }).noteAttributes);
          console.log('  xml:', (src as { xmlElement?: unknown }).xmlElement);
          console.log('  NoteXML:', (src as { NoteXML?: unknown }).NoteXML);
          console.log('  timestamp:', timestamp);
        }
      }
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
