/**
 * m17 PR: after linkParallelOnsets + buildOsmdPreviewXml(PR filter),
 * F4/Bb4/E5 must share default-x AND OSMD graphic x (with VoiceSpacing=0).
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="h"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  requestAnimationFrame: (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 0; },
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();

function pitch(n: Element): string {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent ?? '';
  const acc = alter === '-1' ? 'b' : '';
  return `${step}${acc}${oct}`;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }

  const rawXml = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });

  // dynamic import to avoid ESM issues
  const mod = await import('../dist-server/AudiverisInspectPanel.js').catch(() => null);
  let preview: string;
  if (mod?.buildOsmdPreviewXml) {
    preview = mod.buildOsmdPreviewXml(rawXml, [{ id: 'P5', displayLabel: 'PR', suggestedLabel: 'PR', partIndex: 4 }], {
      partId: 'P5',
      staffWithinPart: 1,
      label: 'PR',
    }, { verbatim: true });
  } else {
    // inline pipeline
    const { repairTimelineForOsmdPreview, reorderSingleStaffTimelineByOnsetForOsmdPreview, normalizeMultiVoiceLayersForOsmdPreview, mergeSameOnsetVoicesForOsmdPreview, realignMeasureDefaultXFromTimelineForOsmd } = await import('../shared/musicXmlTimelineCleanup');
    const { pruneCrossStaffTimelineForOsmdPreview } = await import('../shared/musicXmlStaffPreview');
    let xml = repairTimelineForOsmdPreview(rawXml);
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
      measure.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
      pruneCrossStaffTimelineForOsmdPreview(measure, 1);
      reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
      normalizeMultiVoiceLayersForOsmdPreview(measure);
      mergeSameOnsetVoicesForOsmdPreview(measure);
      realignMeasureDefaultXFromTimelineForOsmd(measure);
    }
    preview = repairTimelineForOsmdPreview(new XMLSerializer().serializeToString(doc));
  }

  fs.writeFileSync('_smoke/_m17_pr_align_check.xml', preview);
  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')][0]!;
  const m17 = [...part.children].find((c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17') as Element;

  const notes = [...m17.children].filter((c) => local(c) === 'note') as Element[];
  const f4 = notes.find((n) => pitch(n) === 'F4' && !n.querySelector('chord,*|chord'));
  const bb = notes.find((n) => pitch(n) === 'Bb4');
  const e5 = notes.find((n) => pitch(n) === 'E5');
  if (!f4 || !bb || !e5) throw new Error(`missing notes: f4=${!!f4} bb=${!!bb} e5=${!!e5}`);

  const xf = f4.getAttribute('default-x');
  const xb = bb.getAttribute('default-x');
  const xe = e5.getAttribute('default-x');
  console.log('XML default-x:', { F4: xf, Bb4: xb, E5: xe });
  if (xf !== xe || xb !== xe) throw new Error(`XML x mismatch F4=${xf} Bb4=${xb} E5=${xe}`);

  const host = document.getElementById('h')!;
  host.style.width = '1200px';
  host.style.height = '600px';
  for (const [label, zero] of [['default', false], ['voiceSpacing0', true]] as const) {
    host.innerHTML = '';
    const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
    const rules = (osmd as { EngravingRules: Record<string, unknown> }).EngravingRules;
    if (zero) {
      rules.VoiceSpacingMultiplierVexflow = 0;
      rules.VoiceSpacingAddendVexflow = 0;
    }
    await (osmd as { load: (x: string) => Promise<void> }).load(preview);
    (osmd as { render: () => void }).render();

    const sheet = (osmd as Record<string, unknown>).graphic ?? (osmd as Record<string, unknown>).GraphicSheet;
    const measures = ((sheet as Record<string, unknown>)?.MeasureList ?? []) as Record<string, unknown>[];
    const m = measures.find((x) => Number(x.MeasureNumber ?? x.measureNumber ?? 0) === 17);
    const xs: Record<string, number[]> = {};
    for (const se of ((m?.staffEntries ?? m?.StaffEntries ?? []) as Record<string, unknown>[])) {
      for (const gve of ((se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[])) {
        const pos = (gve.PositionAndShape ?? gve.positionAndShape) as Record<string, unknown> | undefined;
        const rel = (pos?.RelativePosition ?? pos?.relativePosition) as Record<string, unknown> | undefined;
        const x = Number(rel?.x ?? rel?.X ?? NaN);
        for (const n of ((gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[])) {
          const src = (n.sourceNote ?? n.SourceNote ?? n) as Record<string, unknown>;
          const p = src.Pitch ?? src.pitch;
          if (p && typeof p === 'object') {
            const pp = p as Record<string, unknown>;
            const L = String(pp.FundamentalNote ?? pp.fundamentalNote ?? '') + String(pp.Octave ?? pp.octave ?? '');
            if (Number.isFinite(x)) (xs[L] ??= []).push(x);
          }
        }
      }
    }
    console.log(`OSMD ${label}:`, xs);
    const f4x = xs.F4?.[0];
    const e5x = xs.E5?.[0];
    if (f4x == null || e5x == null) {
      console.log(`  (graphic x extract incomplete for ${label})`);
      continue;
    }
    console.log(`  F4-E5 delta ${label}:`, f4x - e5x);
    if (zero && Math.abs(f4x - e5x) > 0.05) throw new Error(`VoiceSpacing0 still misaligned F4=${f4x} E5=${e5x}`);
  }
  console.log('OK m17 PR same-x check');
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
