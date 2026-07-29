/**
 * m17 po 2/3/4: after SVG layout-grid align, [F4,Bb4] near E5 and po3–po4 gap ~ one eighth.
 * Run: npx tsx _smoke/test_m17_play_order_svg_gap.ts
 */
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
import { applyPlayOrderLayoutToMeasure } from '../shared/musicXmlPlayOrder';
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
  Node: dom.window.Node,
  Element: dom.window.Element,
  requestAnimationFrame: (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function noteheadX(sn: SVGGraphicsElement): number | null {
  const xs: number[] = [];
  for (const path of sn.querySelectorAll('.vf-notehead path')) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const m = /^M\s*([-\d.]+)/.exec(d.trim());
    if (!m) continue;
    const pathEl = path as SVGGraphicsElement;
    const ctm = pathEl.getCTM?.() ?? sn.getCTM?.();
    if (ctm) {
      xs.push(ctm.a * parseFloat(m[1]!) + ctm.e);
      continue;
    }
    let tx = 0;
    let cur: Element | null = pathEl;
    while (cur) {
      const tr = cur.getAttribute?.('transform') ?? '';
      const tm = /translate\(\s*([-\d.]+)/.exec(tr);
      if (tm) tx += parseFloat(tm[1]!);
      cur = cur.parentElement;
    }
    xs.push(tx + parseFloat(m[1]!));
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function pitchFromVf(vfpitch: unknown): string | null {
  const raw = Array.isArray(vfpitch) ? vfpitch[0] : vfpitch;
  if (typeof raw !== 'string') return null;
  const m = /^([a-g])(b?)n\/(\d+)$/i.exec(raw.trim());
  if (!m) return null;
  return `${m[1]!.toUpperCase()}${m[2] === 'b' ? 'b' : ''}${m[3]}`;
}

function buildM17Preview(raw: string): string {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find(
    (c) => local(c) === 'measure' && c.getAttribute('number') === '17',
  ) as Element;
  for (const child of [...m17.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff,*|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  m17.querySelectorAll('note staff,note *|staff').forEach((el) => {
    el.textContent = '1';
  });
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  snapshotNoteDefaultXForOsmdPreview(m17);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  normalizeMultiVoiceLayersForOsmdPreview(m17);
  realignMeasureDefaultXFromTimelineForOsmd(m17);
  applyPlayOrderLayoutToMeasure(m17);

  const attrs = [...m17.children].find((c) => local(c) === 'attributes');
  const clef = '<clef><sign>G</sign><line>2</line></clef>';
  const wrapAttrs = attrs
    ? attrs.outerHTML.replace('</attributes>', `${clef}</attributes>`)
    : `<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type>${clef}</attributes>`;
  const body = [...m17.children]
    .filter((c) => local(c) !== 'attributes')
    .map((c) => c.outerHTML)
    .join('');
  return `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5"><measure number="17">${wrapAttrs}${body}</measure></part></score-partwise>`;
}

type Hit = { pitch: string; voice: string; x: number; heads: number };

function collectM17Hits(osmd: unknown): Hit[] {
  const hits: Hit[] = [];
  const seen = new Set<SVGGraphicsElement>();
  forEachGraphicalMeasure(osmd as never, (gmRaw) => {
    if (measureMxlFromGraphic(gmRaw) !== 17) return;
    const gm = asRecord(gmRaw);
    if (!gm) return;
    for (const seRaw of (gm.staffEntries ?? gm.StaffEntries ?? []) as unknown[]) {
      const se = asRecord(seRaw);
      if (!se) continue;
      for (const gveRaw of (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as unknown[]) {
        const gve = asRecord(gveRaw);
        if (!gve) continue;
        for (const gnRaw of (gve.notes ?? gve.Notes ?? []) as unknown[]) {
          const gn = asRecord(gnRaw);
          if (!gn) continue;
          const pitch = pitchFromVf(gn.vfpitch ?? gn.vfPitch);
          if (!pitch) continue;
          const src = asRecord(gn.sourceNote ?? gn.SourceNote);
          const pve = asRecord(src?.ParentVoiceEntry ?? src?.parentVoiceEntry);
          const pv = asRecord(pve?.ParentVoice ?? pve?.parentVoice);
          const vid = pv?.VoiceId ?? pv?.voiceId;
          const voice = typeof vid === 'number' || typeof vid === 'string' ? String(vid) : '1';
          const rules = asRecord(asRecord(osmd)?.EngravingRules);
          let stavenote: SVGGraphicsElement | null = null;
          try {
            const gnote = (rules?.GNote as ((n: unknown) => unknown) | undefined)?.(src);
            const svgEl = (asRecord(gnote) as { getSVGGElement?: () => SVGGraphicsElement | null } | null)
              ?.getSVGGElement?.();
            if (svgEl) {
              stavenote =
                (svgEl.closest?.('.vf-stavenote, .vf-staveNote') as SVGGraphicsElement | null) ?? svgEl;
            }
          } catch {
            /* ignore */
          }
          if (!stavenote || seen.has(stavenote)) continue;
          seen.add(stavenote);
          const x = noteheadX(stavenote);
          if (x == null) continue;
          const heads = stavenote.querySelectorAll('.vf-notehead').length;
          hits.push({ pitch, voice, x, heads });
        }
      }
    }
  });
  return hits;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_play_order_234.py', {
    encoding: 'utf8',
    maxBuffer: 30e6,
  });
  const preview = buildM17Preview(raw);

  const host = document.getElementById('host')!;
  host.style.width = '900px';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd as never, preview);
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();
  alignOsmdPreviewNotesByOnsetColumn(osmd as never);

  const hits = collectM17Hits(osmd);
  if (hits.length < 4) throw new Error(`too few graphic notes ${hits.length}`);

  const e5 = hits.find((h) => h.pitch === 'E5');
  const f5 = hits.find((h) => h.pitch === 'F5' && h.heads <= 2);
  const f4Po2 = hits
    .filter((h) => h.pitch === 'F4' && h.heads === 2)
    .sort((a, b) => a.x - b.x)[0];
  const f4Po4 = hits
    .filter((h) => h.pitch === 'F4' && h.heads >= 4)
    .sort((a, b) => a.x - b.x)[0];

  if (!e5 || !f5 || !f4Po2 || !f4Po4) {
    throw new Error(
      `missing hits e5=${!!e5} f5=${!!f5} f4Po2=${!!f4Po2} f4Po4=${!!f4Po4} all=${JSON.stringify(hits)}`,
    );
  }

  const po2Gap = Math.abs(f4Po2.x - e5.x);
  if (po2Gap > 14) {
    throw new Error(`[F4,Bb4] must sit with E5 (po2) gap=${po2Gap} f4=${f4Po2.x} e5=${e5.x}`);
  }
  if (f5.x <= e5.x + 5) {
    throw new Error(`po3 F5 must be right of po2 got f5=${f5.x} e5=${e5.x}`);
  }
  if (f4Po4.x <= f5.x + 5) {
    throw new Error(`po4 must be right of po3 got po4=${f4Po4.x} f5=${f5.x}`);
  }
  const gap23 = f5.x - e5.x;
  const gap34 = f4Po4.x - f5.x;
  if (gap34 > gap23 * 2.5) {
    throw new Error(`po3–po4 gap too wide vs po2–po3: gap23=${gap23} gap34=${gap34}`);
  }

  console.log('OK m17 play-order svg gap', {
    e5: e5.x,
    f4Po2: f4Po2.x,
    f5: f5.x,
    f4Po4: f4Po4.x,
    gap23,
    gap34,
    po2Gap,
  });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
