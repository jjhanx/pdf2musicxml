/**
 * Full buildOsmdPreviewXml path for m17 + OSMD graphic X dump.
 * Run: npx tsx _smoke/test_m17_full_preview_osmd.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';

const OpenSheetMusicDisplay =
  (osmdLib as { OpenSheetMusicDisplay?: typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay })
    .OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: typeof import('opensheetmusicdisplay').OpenSheetMusicDisplay } })
    .default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
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

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }

  const { buildOsmdPreviewXml } = await import('../src/AudiverisInspectPanel.tsx');
  const rawXml = execSync('python _smoke/_export_m17_parallel_fix.py', { encoding: 'utf8', maxBuffer: 20e6 });
  if (!rawXml.trimStart().startsWith('<?xml')) {
    const wrapped = `<?xml version="1.0" encoding="UTF-8"?>\n${rawXml}`;
    fs.writeFileSync('_smoke/_m17_raw_wrapped.xml', wrapped);
  }

  const scoreParts = [{ id: 'P5', displayLabel: 'Piano PR', suggestedLabel: 'PR', partIndex: 4 }];
  const preview = buildOsmdPreviewXml(rawXml, scoreParts as never, {
    partId: 'P5',
    staffWithinPart: 1,
    label: 'PR',
  }, { verbatim: true });

  fs.writeFileSync('_smoke/_m17_full_preview.xml', preview);

  const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
  const doc = new DOMParser().parseFromString(preview, 'text/xml');
  const part = [...doc.querySelectorAll('part, *|part')][0];
  const m17 = [...part!.children].find(
    (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '17',
  ) as Element;
  console.log('m17 preview timeline order:');
  for (const c of [...m17.children].slice(0, 12)) {
    const tag = local(c);
    if (tag === 'note') {
      const step = c.querySelector('step,*|step')?.textContent;
      const oct = c.querySelector('octave,*|octave')?.textContent;
      console.log(`  ${step}${oct} x=${c.getAttribute('default-x')} v=${c.querySelector('voice,*|voice')?.textContent}`);
    } else if (tag === 'forward') {
      console.log(`  forward d=${c.querySelector('duration,*|duration')?.textContent} v=${c.querySelector('voice,*|voice')?.textContent}`);
    } else console.log(`  ${tag}`);
  }

  const host = document.getElementById('host')!;
  const osmd = new OpenSheetMusicDisplay!(host, { autoResize: false, backend: 'svg', drawMeasureNumbers: false });
  await osmd.load(preview);
  osmd.render();

  const sheet = (osmd as unknown as { graphic?: { MeasureList?: unknown[] } }).graphic;
  const measures = (sheet?.MeasureList ?? []) as Record<string, unknown>[];
  const m = measures.find((x) => Number(x.MeasureNumber ?? x.measureNumber ?? 0) === 17);
  if (!m) throw new Error('m17 not in OSMD graphic');

  const xs: Record<string, number[]> = {};
  const staffEntries = (m.staffEntries ?? m.StaffEntries ?? []) as Record<string, unknown>[];
  for (const se of staffEntries) {
    const pos = (se.PositionAndShape ?? se.positionAndShape) as Record<string, unknown> | undefined;
    const rel = (pos?.RelativePosition ?? pos?.relativePosition) as Record<string, unknown> | undefined;
    const x = Number(rel?.x ?? rel?.X ?? NaN);
    const gves = (se.graphicalVoiceEntries ?? se.GraphicalVoiceEntries ?? []) as Record<string, unknown>[];
    for (const gve of gves) {
      const notes = (gve.notes ?? gve.Notes ?? []) as Record<string, unknown>[];
      for (const n of notes) {
        const src = (n.sourceNote ?? n.SourceNote ?? n) as Record<string, unknown>;
        const pitch = src.Pitch ?? src.pitch;
        let label = '?';
        if (pitch && typeof pitch === 'object') {
          const p = pitch as Record<string, unknown>;
          label = String(p.FundamentalNote ?? p.fundamentalNote ?? '?') + String(p.Octave ?? p.octave ?? '');
        }
        if (!xs[label]) xs[label] = [];
        if (Number.isFinite(x)) xs[label].push(x);
      }
    }
  }
  console.log('OSMD graphic X:', xs);
  const f4x = xs.F4?.[0];
  const e5x = xs.E5?.[0];
  if (f4x == null || e5x == null) throw new Error('missing F4 or E5 in graphic');
  if (Math.abs(f4x - e5x) > 0.05) {
    throw new Error(`MISALIGN F4 x=${f4x} E5 x=${e5x}`);
  }
  console.log('OK aligned', { f4x, e5x });
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
