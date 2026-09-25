/**
 * Natural accidental pitch matching (OSMD Gn4 <-> MusicXML G4) and beam monotonicity regression test.
 * Run: npx tsx _smoke/test_natural_accidental_beam_order.ts
 */
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  alignOsmdPreviewNotesByOnsetColumn,
  registerOsmdPreviewXmlForAlign,
} from '../src/osmdOnsetColumnAlignFix';
import { containOsmdMeasureNotesInAllocatedWidth, clipOsmdMeasuresToAllocatedWidth } from '../src/osmdMeasureTimingWarning';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default
    ?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host" style="width: 800px;"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
});
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', { get() { return 800; } });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get() { return 800; } });
dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400 } as any);

const SAMPLE = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>PR</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1" width="400">
      <attributes>
        <divisions>12</divisions>
        <key><fifths>2</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note default-x="30"><pitch><step>A</step><octave>4</octave></pitch><duration>12</duration><type>quarter</type><voice>1</voice></note>
      <note default-x="80"><pitch><step>C</step><octave>5</octave></pitch><duration>12</duration><type>quarter</type><voice>1</voice></note>
      <note default-x="130"><pitch><step>A</step><octave>4</octave></pitch><duration>6</duration><type>eighth</type><voice>1</voice><beam number="1">begin</beam><beam number="2">begin</beam></note>
      <note default-x="150"><pitch><step>G</step><octave>4</octave></pitch><duration>6</duration><type>eighth</type><accidental>natural</accidental><voice>1</voice><beam number="1">continue</beam><beam number="2">end</beam></note>
      <note default-x="170"><pitch><step>F</step><octave>4</octave></pitch><duration>12</duration><type>quarter</type><voice>1</voice><beam number="1">end</beam></note>
    </measure>
  </part>
</score-partwise>`;

async function run() {
  const host = dom.window.document.getElementById('host')!;
  host.innerHTML = '';
  const osmd = new (OSMD as any)(host, { autoResize: false, backend: 'svg', drawMeasureNumbers: false });
  registerOsmdPreviewXmlForAlign(osmd, SAMPLE);
  await osmd.load(SAMPLE);
  osmd.render();

  containOsmdMeasureNotesInAllocatedWidth(host, osmd);
  clipOsmdMeasuresToAllocatedWidth(host, osmd);
  alignOsmdPreviewNotesByOnsetColumn(osmd, SAMPLE);
  alignOsmdPreviewNotesByOnsetColumn(osmd, SAMPLE);
  clipOsmdMeasuresToAllocatedWidth(host, osmd);

  const notes = Array.from(host.querySelectorAll('.vf-stavenote'));
  assert.strictEqual(notes.length, 5, 'Must have 5 notes rendered');

  const centers = notes.map((el) => {
    const tr = el.getAttribute('transform') || '';
    let tx = 0;
    const m = /translate\(\s*([-\d.]+)/.exec(tr);
    if (m) tx = parseFloat(m[1]!);
    const ds = Array.from(el.querySelectorAll('path')).map((p) => p.getAttribute('d') || '');
    let minX = Infinity, maxX = -Infinity;
    for (const d of ds) {
      for (const match of d.matchAll(/[MmLl]\s*([-\d.]+)/g)) {
        const x = parseFloat(match[1]!);
        if (Number.isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      }
    }
    return (minX + maxX) / 2 + tx;
  });

  // Verify strictly monotonic positions
  for (let i = 1; i < centers.length; i++) {
    assert.ok(
      centers[i]! > centers[i - 1]!,
      `Note #${i} (x=${centers[i]}) must be strictly to the right of Note #${i - 1} (x=${centers[i - 1]})`,
    );
  }

  // Verify beam paths do not fold backwards
  const beams = Array.from(host.querySelectorAll('.vf-beam path'));
  for (const b of beams) {
    const d = b.getAttribute('d') || '';
    const xs: number[] = [];
    for (const match of d.matchAll(/[MmLl]\s*([-\d.]+)/g)) {
      xs.push(parseFloat(match[1]!));
    }
    // A beam quad path is M x1 y1 L x1 y2 L x2 y3 L x2 y4 Z
    if (xs.length >= 4) {
      const leftX = xs[0]!;
      const rightX = xs[2]!;
      assert.ok(rightX > leftX, `Beam path must extend from left to right (x1=${leftX}, x2=${rightX})`);
    }
  }

  console.log('test_natural_accidental_beam_order ok');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
