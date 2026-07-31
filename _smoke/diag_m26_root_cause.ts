/**
 * Reproduce m26→m27 OSMD shift with ACTUAL 0ea5 review.mxl + full HITL pipeline.
 * Run: npx tsx _smoke/diag_m26_root_cause.ts
 */
import { readFileSync, existsSync } from 'fs';
import { JSDOM } from 'jsdom';
import {
  buildOsmdPreviewXml,
  parseScoreParts,
  type ScorePartForPreview,
} from '../src/AudiverisInspectPanel.tsx';
import {
  repairTimelineForOsmdPreview,
  removeDanglingTimelineElementsForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup.ts';
import { repairUnderfullMeasuresForOsmdPreview } from '../shared/musicXmlUnderfullMeasureForOsmd.ts';
import { repairRestDisplayForOsmdPreview, repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';
import { countDanglingTimelineElements } from '../shared/musicXmlTimelineCleanup.ts';
import { measureMxlFromGraphic, forEachOsmdSystem, partIdFromGraphic } from '../src/osmdMeasureClick.ts';

const XML_PATHS = [
  '_smoke/_0ea5_review.xml',
  '_smoke/_cheongsan_review.xml',
  '_smoke/_raw_cheongsan.xml',
];

function loadXml(): { label: string; xml: string } {
  for (const p of XML_PATHS) {
    if (existsSync(p)) return { label: p, xml: readFileSync(p, 'utf8') };
  }
  throw new Error('no fixture');
}

function setupDom(w: number) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="host" style="width:${w}px;height:16000px"></div></body></html>`);
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
  return dom.window.document.getElementById('host') as HTMLDivElement;
}

function osmdPitchToken(p: Record<string, unknown>): string {
  const names = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const fn = p.FundamentalNote ?? p.fundamentalNote;
  const oct = p.Octave ?? p.octave;
  const alt = p.Accidental ?? p.accidental;
  if (typeof fn !== 'number' || typeof oct !== 'number') return '?';
  let s = `${names[fn] ?? fn}${oct}`;
  if (typeof alt === 'number' && alt !== 0) s += alt > 0 ? `#` : 'b';
  return s;
}

function graphicFirstPitch(gm: Record<string, unknown>): string | null {
  const entries = (gm.staffEntries ?? gm.StaffEntries) as unknown[] | undefined;
  for (const entry of entries ?? []) {
    const er = entry as Record<string, unknown>;
    const gves = (er.graphicalVoiceEntries ?? er.GraphicalVoiceEntries) as unknown[] | undefined;
    for (const gve of gves ?? []) {
      const gr = gve as Record<string, unknown>;
      for (const note of (gr.notes ?? gr.Notes ?? []) as unknown[]) {
        const nr = note as Record<string, unknown>;
        const src = (nr.sourceNote ?? nr.SourceNote) as Record<string, unknown> | undefined;
        const pitch = (src?.Pitch ?? src?.pitch) as Record<string, unknown> | undefined;
        if (pitch) return osmdPitchToken(pitch);
      }
    }
  }
  return null;
}

function sanitizeLikeOsmdBlock(xml: string): string {
  let out = repairRestDisplayForOsmdPreview(xml);
  out = repairMissingNoteTypesForOsmdPreview(out);
  out = repairTimelineForOsmdPreview(out);
  out = repairUnderfullMeasuresForOsmdPreview(out);
  return out;
}

async function runOsmd(label: string, xml: string, width: number) {
  const host = setupDom(width);
  host.innerHTML = '';
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: true,
    backend: 'svg',
    drawMeasureNumbers: false,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);
  await osmd.load(xml);
  osmd.zoom = 0.55;
  osmd.render();

  const rows: string[] = [];
  forEachOsmdSystem(osmd, (_s, grid) => {
    for (let si = 0; si < Math.min(grid.length, 7); si++) {
      for (const mn of [25, 26, 27]) {
        const gm = grid[si]?.find((g) => measureMxlFromGraphic(g as Record<string, unknown>) === mn);
        if (!gm) {
          rows.push(`${label} w${width} st${si} m${mn} MISSING`);
          continue;
        }
        const pid = partIdFromGraphic(gm as Record<string, unknown>);
        rows.push(`${label} w${width} st${si} ${pid} m${mn} first=${graphicFirstPitch(gm as Record<string, unknown>)}`);
      }
    }
  });

  let p1m26: string | null = null;
  let p1m27: string | null = null;
  forEachOsmdSystem(osmd, (_s, grid) => {
    for (const gm of grid[0] ?? []) {
      if (!gm || partIdFromGraphic(gm as Record<string, unknown>) !== 'P1') continue;
      const n = measureMxlFromGraphic(gm as Record<string, unknown>);
      if (n === 26) p1m26 = graphicFirstPitch(gm as Record<string, unknown>);
      if (n === 27) p1m27 = graphicFirstPitch(gm as Record<string, unknown>);
    }
  });
  return { rows, p1m26, p1m27, shift: p1m26 === p1m27 && p1m26 != null };
}

async function main() {
  const { label, xml: raw } = loadXml();
  console.log('fixture', label);
  console.log('raw dangling timeline', countDanglingTimelineElements(raw));

  const partsRaw = parseScoreParts(raw);
  const scoreParts: ScorePartForPreview[] = partsRaw.map((p) => ({
    id: p.id,
    displayLabel: p.name,
    suggestedLabel: p.name,
  }));

  const preview = buildOsmdPreviewXml(raw, scoreParts, null, { verbatim: true });
  const final = sanitizeLikeOsmdBlock(preview);
  console.log('after build dangling', countDanglingTimelineElements(preview));
  console.log('after sanitize dangling', countDanglingTimelineElements(final));
  console.log('has system-layout', /<system-layout/i.test(final));
  console.log('has measure width', /measure[^>]*width=/i.test(final));

  for (const w of [1800, 960, 720, 480]) {
    const r = await runOsmd('full', final, w);
    r.rows.forEach((line) => console.log(line));
    console.log(`summary w${w}`, { p1m26: r.p1m26, p1m27: r.p1m27, shift: r.shift });
    if (r.p1m26 !== 'F5') console.error(`FAIL w${w}: P1 m26 expected F5 got ${r.p1m26}`);
    if (r.p1m27 === r.p1m26) console.error(`FAIL w${w}: m26 equals m27 (${r.p1m26})`);
  }

  // raw without cleanup
  const rawSan = sanitizeLikeOsmdBlock(raw);
  const r0 = await runOsmd('raw-only', rawSan, 720);
  console.log('raw-only 720', { p1m26: r0.p1m26, p1m27: r0.p1m27 });
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
