/**
 * 청산 25마디 orphan backup → OSMD 26마디 공백 회귀
 * Run: npx tsx _smoke/test_cheongsan_timeline_cleanup.ts
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  countDanglingTimelineElements,
  inferFirstMxlMeasureForPdfPage,
  removeDanglingTimelineElementsForOsmdPreview,
  stripPageBreakPrintForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(globalThis as unknown as { window: Window }).window = dom.window as unknown as Window;
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
(globalThis as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer = dom.window.XMLSerializer;

function countM26Notes(xml: string): number {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
  let total = 0;
  for (const part of [...doc.querySelectorAll('part, *|part')]) {
    const pid = part.getAttribute('id') ?? '';
    if (!/^P[1-5]/.test(pid)) continue;
    const meas = [...part.children].find(
      (c) => local(c as Element) === 'measure' && (c as Element).getAttribute('number') === '26',
    );
    if (!meas) continue;
    total += [...meas.children].filter((c) => local(c as Element) === 'note').length;
  }
  return total;
}

async function main() {
  const raw = fs.readFileSync('_smoke/_cheongsan_review.xml', 'utf8');
  const before = countDanglingTimelineElements(raw);
  if (before < 5) throw new Error(`expected >=5 dangling backups before cleanup, got ${before}`);

  const cleaned = stripPageBreakPrintForOsmdPreview(
    removeDanglingTimelineElementsForOsmdPreview(raw),
  );
  const after = countDanglingTimelineElements(cleaned);
  if (after !== 0) throw new Error(`expected 0 dangling after cleanup, got ${after}`);

  const page5Start = inferFirstMxlMeasureForPdfPage(raw, 5);
  if (page5Start !== 25) throw new Error(`expected PDF page 5 -> m25, got ${page5Start}`);

  if (cleaned.includes('new-page="yes"')) {
    throw new Error('stripPageBreakPrintForOsmdPreview must remove new-page attributes');
  }

  const notes26 = countM26Notes(cleaned);
  if (notes26 < 20) throw new Error(`expected m26 notes preserved, got ${notes26}`);

  console.log('cheongsan timeline cleanup ok', { before, after, notes26 });
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
