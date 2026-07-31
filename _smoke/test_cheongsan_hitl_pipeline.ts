/**
 * HITL pipeline: buildOsmdPreviewXml + sanitize — m25 backup / m26 notes
 * Run: npx tsx _smoke/test_cheongsan_hitl_pipeline.ts
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  removeDanglingTimelineElementsForOsmdPreview,
  countDanglingTimelineElements,
} from '../shared/musicXmlTimelineCleanup.ts';
import { repairRestDisplayForOsmdPreview } from '../shared/musicXmlRestDisplay.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.DOMParser = dom.window.DOMParser;
g.XMLSerializer = dom.window.XMLSerializer;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;

function measureSummary(xml: string, partId: string, m: number): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
  const part = [...doc.querySelectorAll('part, *|part')].find((p) => p.getAttribute('id') === partId);
  if (!part) return 'NO_PART';
  const meas = [...part.children].find(
    (c) => local(c as Element) === 'measure' && parseInt((c as Element).getAttribute('number') ?? '0', 10) === m,
  ) as Element | undefined;
  if (!meas) return 'NO_MEAS';
  return [...meas.children]
    .map((c) => {
      const tag = local(c as Element);
      if (tag === 'backup' || tag === 'forward') {
        const dur = (c as Element).querySelector('duration, *|duration')?.textContent ?? '?';
        return `${tag}(${dur})`;
      }
      return tag;
    })
    .join(',');
}

function sanitizeLikeHitl(xml: string): string {
  let out = xml;
  out = repairRestDisplayForOsmdPreview(out);
  out = removeDanglingTimelineElementsForOsmdPreview(out);
  return out;
}

async function main() {
  const raw = fs.readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const mod = await import('../src/AudiverisInspectPanel.tsx');
  const scoreParts = [
    { id: 'P1', displayLabel: 'S' },
    { id: 'P2', displayLabel: 'A' },
    { id: 'P3', displayLabel: 'T' },
    { id: 'P4', displayLabel: 'B' },
    { id: 'P5', displayLabel: 'P' },
  ];

  const preview = mod.buildOsmdPreviewXml(raw, scoreParts, null, { verbatim: true });
  console.log('after split dangling', countDanglingTimelineElements(preview));
  console.log('P1 m25 before sanitize:', measureSummary(preview, 'P1', 25));

  const sanitized = sanitizeLikeHitl(preview);
  console.log('after sanitize dangling', countDanglingTimelineElements(sanitized));
  console.log('P1 m25 after sanitize:', measureSummary(sanitized, 'P1', 25));
  console.log('P1 m26 after sanitize:', measureSummary(sanitized, 'P1', 26));

  if (countDanglingTimelineElements(sanitized) !== 0) {
    throw new Error('dangling backups remain after sanitize');
  }
  if (measureSummary(sanitized, 'P1', 25).includes('backup')) {
    throw new Error('P1 m25 still has backup after sanitize');
  }

  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  const host = document.createElement('div');
  host.style.width = '1400px';
  host.style.height = '6000px';
  document.body.appendChild(host);
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    drawComposer: false,
    drawMeasureNumbers: false,
  } as ConstructorParameters<typeof OpenSheetMusicDisplay>[1]);

  await osmd.load(sanitized);
  osmd.zoom = 0.35;
  osmd.render();

  const measures = (osmd.GraphicSheet as { MeasureList?: Array<{ MeasureNumber?: number; measureNumber?: number; staffEntries?: unknown[] }> })?.MeasureList ?? [];
  const m26 = measures.filter((x) => Number(x.MeasureNumber ?? x.measureNumber) === 26);
  const entries = m26.reduce((a, x) => a + ((x.staffEntries ?? []) as unknown[]).length, 0);
  console.log('OSMD m26 measures', m26.length, 'entries', entries);
  if (entries < 4) throw new Error(`OSMD m26 too empty: ${entries}`);
  console.log('hitl pipeline ok');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
