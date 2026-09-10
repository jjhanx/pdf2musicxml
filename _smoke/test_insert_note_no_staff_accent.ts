/**
 * Bass 마디에 액센트 있는 화음 뒤에 음표를 넣으면
 * 새 음·오선 복판에 유령 `>` 가 생기면 안 된다.
 *
 * Run: npx tsx _smoke/test_insert_note_no_staff_accent.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';
import { prepareArticulationDefaultYForOsmdPreview, repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;
if (!OSMD) throw new Error('OSMD missing');

function setupDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      setTimeout(() => cb(0), 0);
      return 0;
    },
  });
  const proto = dom.window.SVGGraphicsElement.prototype as SVGGraphicsElement;
  if (!proto.getBBox) {
    proto.getBBox = function () {
      return { x: 0, y: 0, width: 12, height: 12 } as DOMRect;
    };
  }
}

function pathStart(d: string): { x: number; y: number } | null {
  const m = /M\s*([-\d.eE+]+)\s+([-\d.eE+]+)/.exec(d);
  if (!m) return null;
  return { x: parseFloat(m[1]!), y: parseFloat(m[2]!) };
}

function noteHeadX(stave: Element): number | null {
  const nh = stave.querySelector('.vf-notehead path, .vf-note path');
  if (!nh) return null;
  return pathStart(nh.getAttribute('d') ?? '')?.x ?? null;
}

function visibleAccentXs(stave: Element): number[] {
  const xs: number[] = [];
  for (const p of stave.querySelectorAll('.vf-modifiers path')) {
    if (p.getAttribute('data-hitl-art-hidden') === '1') continue;
    const op = (p as SVGElement).style?.opacity ?? p.getAttribute('opacity');
    if (op === '0') continue;
    const xy = pathStart(p.getAttribute('d') ?? '');
    if (xy) xs.push(xy.x);
  }
  return xs;
}

/** E1/E2 half+dot, E2/B2 quarter+accent+fermata, inserted G2 quarter (no art) */
const xml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P4"><part-name>B</part-name></score-part></part-list>
  <part id="P4">
    <measure number="77">
      <attributes>
        <divisions>4</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>E</step><octave>1</octave></pitch>
        <duration>12</duration><voice>1</voice><type>half</type><dot/><stem>up</stem>
      </note>
      <note>
        <chord/>
        <pitch><step>E</step><octave>2</octave></pitch>
        <duration>12</duration><voice>1</voice><type>half</type><dot/><stem>up</stem>
      </note>
      <note>
        <pitch><step>E</step><octave>2</octave></pitch>
        <duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
        <notations>
          <fermata type="upright" placement="above"/>
          <articulations><accent placement="below" default-y="-10"/></articulations>
        </notations>
      </note>
      <note>
        <chord/>
        <pitch><step>B</step><octave>2</octave></pitch>
        <duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
      </note>
      <note>
        <pitch><step>G</step><octave>2</octave></pitch>
        <duration>4</duration><voice>1</voice><type>quarter</type><stem>up</stem>
      </note>
    </measure>
  </part>
</score-partwise>`;

async function main() {
  setupDom();
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '400px';
  document.body.appendChild(host);

  const loadXml = prepareArticulationDefaultYForOsmdPreview(repairTimelineForOsmdPreview(xml));
  const osmd = new OSMD(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    useXMLMeasureNumbers: true,
  });
  registerOsmdPreviewXmlForArticulation(osmd, loadXml);
  await osmd.load(loadXml);
  osmd.render();
  applyOsmdArticulationOffsetsDetailed(host, osmd);

  const staves = [...host.querySelectorAll('.vf-stavenote')];
  if (staves.length < 3) throw new Error(`expected ≥3 stavenotes, got ${staves.length}`);
  const inserted = staves[staves.length - 1]!;
  const insX = noteHeadX(inserted);
  if (insX == null) throw new Error('inserted note has no notehead');

  const ghost = visibleAccentXs(inserted);
  if (ghost.length) {
    throw new Error(`ghost native accent on inserted G2 at x=${ghost.join(',')}`);
  }

  const overlaysOnInsert = [...host.querySelectorAll('[data-hitl-art-overlay="accent"], [data-hitl-art-tag="accent"]')].filter(
    (el) => {
      if (el.getAttribute('data-hitl-art-hidden') === '1') return false;
      const op = (el as SVGElement).style?.opacity ?? el.getAttribute('opacity');
      if (op === '0') return false;
      const x = parseFloat(el.getAttribute('x') || '');
      if (!Number.isFinite(x)) return false;
      const others = staves.slice(0, -1).map((s) => noteHeadX(s)).filter((v): v is number => v != null);
      const distIns = Math.abs(x - insX);
      return others.every((ox) => distIns < Math.abs(x - ox) - 2);
    },
  );
  if (overlaysOnInsert.length) {
    throw new Error('accent overlay closer to inserted G2 than to the accented chord');
  }

  const fallbackY = [...host.querySelectorAll('[data-hitl-art-overlay="accent"]')].filter((el) => {
    const y = parseFloat(el.getAttribute('y') || '');
    return Number.isFinite(y) && y > 0 && y < 45;
  });
  if (fallbackY.length) {
    throw new Error(`accent overlay parked on the staff (y<45): ${fallbackY.map((e) => e.getAttribute('y')).join(',')}`);
  }

  console.log('insert note no staff-accent OK', {
    insX,
    debug: host.getAttribute('data-hitl-art-debug'),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
