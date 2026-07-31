import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
  collectLinkedParallelOnsetHintsFromXml,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import {
  collectPreviewNoteLayoutTargetsFromXml,
  collectExplicitPlayOrderColumnsFromXml,
  collectPlayOrderAlignGroupsFromXml,
} from '../shared/musicXmlPlayOrder';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

const raw = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
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
  [...measure.querySelectorAll('note staff,note *|staff')].forEach((el) => {
    el.textContent = '1';
  });
  pruneCrossStaffTimelineForOsmdPreview(measure, 1);
  snapshotNoteDefaultXForOsmdPreview(measure);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
  normalizeMultiVoiceLayersForOsmdPreview(measure);
  realignMeasureDefaultXFromTimelineForOsmd(measure);
}
const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17')!;
const slice =
  '<?xml version="1.0"?><score-partwise><part-list><score-part id="P5"><part-name/></score-part></part-list>' +
  `<part id="P5">${m17.outerHTML}</part></score-partwise>`;

console.log('linked hints', collectLinkedParallelOnsetHintsFromXml(slice));
console.log('explicit cols', collectExplicitPlayOrderColumnsFromXml(slice));
console.log('align groups', collectPlayOrderAlignGroupsFromXml(slice));
console.log('targets sample', collectPreviewNoteLayoutTargetsFromXml(slice).slice(0, 15));

async function main() {
  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, slice);
  await (osmd as { load: (x: string) => Promise<void> }).load(slice);
  (osmd as { render: () => void }).render();

  const noteheadX = (sn: SVGGraphicsElement) => {
    const bb = sn.getBBox?.();
    if (!bb || bb.width <= 0) return null;
    let tx = 0;
    let cur: Element | null = sn;
    while (cur) {
      const tr = cur.getAttribute?.('transform') ?? '';
      const tm = /translate\(\s*([-\d.]+)/.exec(tr);
      if (tm) tx += parseFloat(tm[1]!);
      cur = cur.parentElement;
    }
    return tx + bb.x + bb.width / 2;
  };

  const { forEachGraphicalMeasure: fegm, measureMxlFromGraphic: mmxl } = await import('../src/osmdMeasureClick');

  // mimic test: offset one multi-voice graphic
  fegm(osmd as never, (gm) => {
    if (mmxl(gm) !== 17) return;
    const g = gm as Record<string, unknown>;
    for (const se of (g.staffEntries ?? g.StaffEntries ?? []) as Record<string, unknown>[]) {
      const gves = (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[];
      if (gves.length < 2) continue;
      const gn = ((gves[0]?.notes ?? gves[0]?.Notes ?? []) as Record<string, unknown>[])[0];
      if (gn && typeof gn.getSVGGElement === 'function') {
        const offsetTarget = gn.getSVGGElement() as SVGGraphicsElement;
        const tr = offsetTarget.getAttribute('transform') ?? '';
        offsetTarget.setAttribute('transform', tr ? `translate(30, 0) ${tr}` : 'translate(30, 0)');
      }
    }
  });

  const stavenotes = [...host.querySelectorAll('.vf-stavenote,.vf-staveNote')];
  console.log('stavenote count', stavenotes.length);

  const noteheadCenterX = (stavenote: SVGGraphicsElement): number | null => {
    const xs: number[] = [];
    for (const path of stavenote.querySelectorAll('.vf-notehead path')) {
      const d = path.getAttribute('d');
      if (!d) continue;
      const m = /^M\s*([-\d.]+)/.exec(d.trim());
      if (!m) continue;
      const localX = parseFloat(m[1]!);
      let tx = 0;
      let cur: Element | null = path as Element;
      while (cur) {
        const tr = cur.getAttribute?.('transform') ?? '';
        const tm = /translate\(\s*([-\d.]+)/.exec(tr);
        if (tm) tx += parseFloat(tm[1]!);
        cur = cur.parentElement;
      }
      xs.push(tx + localX);
    }
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };

  const before = stavenotes
    .map((sn) => noteheadCenterX(sn as SVGGraphicsElement))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  console.log('xs before', before);

  // inspect graphic tree linkage
  let graphicHits = 0;
  let svgHits = 0;
  fegm(osmd as never, (gm) => {
    const g = gm as Record<string, unknown>;
    for (const se of (g.staffEntries ?? g.StaffEntries ?? []) as Record<string, unknown>[]) {
      for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
        for (const gn of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
          graphicHits += 1;
          if (typeof gn.getSVGGElement === 'function') {
            const svg = gn.getSVGGElement();
            if (svg) svgHits += 1;
          }
        }
      }
    }
  });
  console.log('graphic notes', graphicHits, 'with svg', svgHits);

  const STEP = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const pitchLabels: string[] = [];
  fegm(osmd as never, (gm) => {
    if (mmxl(gm) !== 17) return;
    const g = gm as Record<string, unknown>;
    for (const se of (g.staffEntries ?? g.StaffEntries ?? []) as Record<string, unknown>[]) {
      for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
        for (const gn of (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[]) {
          const src = (gn as Record<string, unknown>).sourceNote ?? (gn as Record<string, unknown>).SourceNote;
          const pitch = (src as Record<string, unknown>)?.Pitch ?? (src as Record<string, unknown>)?.pitch;
          const pr = pitch as Record<string, unknown> | undefined;
          const fn = (pr?.FundamentalNote as Record<string, unknown>)?.realValue ?? pr?.FundamentalNote ?? pr?.fundamentalNote;
          const oct = (pr?.Octave as Record<string, unknown>)?.realValue ?? pr?.Octave ?? pr?.octave;
          const acc = (pr?.Accidental as Record<string, unknown>)?.realValue ?? pr?.Accidental ?? pr?.accidental;
          if (typeof fn === 'number' && typeof oct === 'number') {
            pitchLabels.push(`${STEP[fn] ?? '?'}${acc === -1 ? 'b' : acc === 1 ? '#' : ''}${oct}`);
          }
        }
      }
    }
  });
  console.log('pitches', pitchLabels);

  // raw first gn structure
  fegm(osmd as never, (gm) => {
    if (mmxl(gm) !== 17) return;
    const g = gm as Record<string, unknown>;
    for (const se of (g.staffEntries ?? g.StaffEntries ?? []) as Record<string, unknown>[]) {
      for (const gve of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[]) {
        const gn = ((gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[])[0];
        if (gn) {
          const src = gn.sourceNote ?? gn.SourceNote;
          console.log('sample gn keys', Object.keys(gn));
          console.log('sample src keys', src && typeof src === 'object' ? Object.keys(src as object) : src);
          console.log('sample pitch', (src as Record<string, unknown>)?.Pitch ?? (src as Record<string, unknown>)?.pitch);
        }
        return;
      }
    }
  });

  const groups = collectPlayOrderAlignGroupsFromXml(slice);
  console.log('group members', groups[0]?.members);

  alignOsmdPreviewNotesByOnsetColumn(osmd as never);

  const after = stavenotes
    .map((sn) => noteheadCenterX(sn as SVGGraphicsElement))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  console.log('xs after', after);

  // stave span probe
  const sn0 = stavenotes[0] as SVGGraphicsElement;
  const stave = sn0?.closest('.vf-stave') as SVGGraphicsElement | null;
  console.log('stave bbox', stave?.getBBox?.());
  console.log('stave ctm', stave?.getCTM?.());
}

main();
