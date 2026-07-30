/**
 * 4/4 four quarters: equal layout-x gaps (synthetic + m2 explicit quarter POs).
 * Run: npx tsx _smoke/test_four_quarter_even_spacing.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import {
  applyPlayOrderLayoutToMeasure,
  HITL_PLAY_ORDER_ATTR,
} from '../shared/musicXmlPlayOrder';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';

const dom = new JSDOM('<!DOCTYPE html><html></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

function assertEvenGaps(lx: number[], label: string): void {
  if (lx.length < 2) return;
  const gaps = lx.slice(1).map((x, i) => x - lx[i]!);
  const max = Math.max(...gaps);
  const min = Math.min(...gaps);
  if (max / min > 1.05) {
    throw new Error(`${label}: uneven gaps ${gaps.join(', ')} lx=${lx.join(', ')}`);
  }
}

function testSynthetic(): void {
  const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const measure = doc.querySelector('measure')!;
  applyPlayOrderLayoutToMeasure(measure);
  const lx = [...measure.children]
    .filter((c) => c.localName === 'note')
    .map((n) => parseFloat(n.getAttribute('data-osmd-layout-x') ?? '0'));
  assertEvenGaps(lx.sort((a, b) => a - b), 'synthetic 4 quarters');
}

function testM2ExplicitQuarters(): void {
  if (!fs.existsSync('omr-work-4637986c.zip')) return;
  execSync(
    'python -c "import io,zipfile; from pathlib import Path; z=zipfile.ZipFile(\'omr-work-4637986c.zip\'); d=z.read(\'review.mxl\'); i=zipfile.ZipFile(io.BytesIO(d)); xml=i.read([n for n in i.namelist() if n.endswith(\'.xml\') and \'META\' not in n.upper()][0]); Path(\'_smoke/_tmp_463_raw.xml\').write_bytes(xml)"',
    { stdio: 'pipe' },
  );
  let xml = repairTimelineForOsmdPreview(fs.readFileSync('_smoke/_tmp_463_raw.xml', 'utf8'));
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m2 = [...part.children].find((c) => c.localName === 'measure' && c.getAttribute('number') === '2')!;
  for (const child of [...m2.children]) {
    if (child.localName === 'note') {
      const st = child.querySelector('staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  pruneCrossStaffTimelineForOsmdPreview(m2, 1);
  snapshotNoteDefaultXForOsmdPreview(m2);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m2);
  normalizeMultiVoiceLayersForOsmdPreview(m2);
  const leaders = [...m2.children].filter(
    (c) => c.localName === 'note' && !c.querySelector('chord'),
  );
  leaders
    .filter((n) => (n.querySelector('duration')?.textContent ?? '') === '2')
    .forEach((n, i) => {
      const po = String(i + 1);
      let cur: Element | null = n;
      while (cur && cur.localName === 'note') {
        cur.setAttribute(HITL_PLAY_ORDER_ATTR, po);
        const next = cur.nextElementSibling;
        if (!next || next.localName !== 'note' || !next.querySelector('chord')) break;
        cur = next;
      }
    });
  realignMeasureDefaultXFromTimelineForOsmd(m2);
  const qLx = leaders
    .filter((n) => n.getAttribute(HITL_PLAY_ORDER_ATTR) && n.querySelector('duration')?.textContent === '2')
    .map((n) => parseFloat(n.getAttribute('data-osmd-layout-x') ?? '0'));
  const unique = [...new Set(qLx)].sort((a, b) => a - b);
  assertEvenGaps(unique, 'm2 explicit quarter POs');
}

function main(): void {
  testSynthetic();
  testM2ExplicitQuarters();
  console.log('OK four-quarter even spacing');
}

main();
