/**
 * PL에 tenuto/accent를 넣을 때 duration dot·페르마타가 '.' 로 남지 않는지,
 * 그리고 XML에 없는 이웃 음에 accent overlay가 생기지 않는지.
 *
 * Repro: piano staff2 dotted half + fermata chord; editor noteIndex is the
 * full-part index (28) after PR/PL split. Run: npx tsx _smoke/test_pl_add_art_no_dot_ghost.ts
 */
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance.ts';
import { stampHitlSourceNoteIdentity } from '../shared/musicXmlStaffPreview.ts';
import { prepareArticulationDefaultYForOsmdPreview, repairTimelineForOsmdPreview } from '../shared/musicXmlTimelineCleanup.ts';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdArticulationFixes,
  registerOsmdPreviewXmlForArticulation,
} from '../src/osmdArticulationOffsetFix.ts';

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

/** 2단: staff1 더미 28음 + staff2 점2분 A3 + 화음(페르마타). 편집기 index 28 = PL 점2분. */
function twoStaffXml(): string {
  const dummy = Array.from({ length: 28 }, () =>
    `<note><pitch><step>E</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>16th</type><stem>up</stem><staff>1</staff></note>`,
  ).join('');
  return `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list>
  <part id="P5">
    <measure number="77">
      <attributes>
        <divisions>8</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      ${dummy}
      <backup><duration>28</duration></backup>
      <note>
        <pitch><step>A</step><octave>3</octave></pitch>
        <duration>12</duration><voice>2</voice><type>half</type><dot/>
        <stem>up</stem><staff>2</staff>
      </note>
      <note>
        <pitch><step>E</step><octave>3</octave></pitch>
        <duration>4</duration><voice>2</voice><type>quarter</type>
        <stem>up</stem><staff>2</staff>
        <notations><fermata type="upright" placement="above"/></notations>
      </note>
      <note>
        <chord/>
        <pitch><step>A</step><octave>3</octave></pitch>
        <duration>4</duration><voice>2</voice><type>quarter</type>
        <stem>up</stem><staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;
}

/** PL 미리보기처럼 staff2만 남기고 원본 noteIndex를 stamp. */
function plOnlyPreviewXml(src: string): string {
  const doc = new DOMParser().parseFromString(src, 'text/xml');
  const measure = [...doc.getElementsByTagName('measure')][0];
  if (!measure) throw new Error('no measure');
  stampHitlSourceNoteIdentity(measure);
  for (const n of [...measure.getElementsByTagName('note')]) {
    const staff = n.getElementsByTagName('staff')[0]?.textContent?.trim() || '1';
    if (staff !== '2') n.remove();
  }
  for (const s of [...measure.getElementsByTagName('staff')]) s.textContent = '1';
  for (const b of [...measure.getElementsByTagName('backup')]) b.remove();
  return new XMLSerializer().serializeToString(doc);
}

async function main() {
  setupDom();
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '500px';
  document.body.appendChild(host);

  const fixes = [
    {
      kind: 'addArticulation',
      partId: 'P5',
      measureMxl: '77',
      noteIndex: 28,
      articulation: 'tenuto',
      placement: 'below' as const,
      distance: '3',
      pitchStep: 'A',
      pitchOctave: 3,
      staff: 2,
    },
    {
      kind: 'addArticulation',
      partId: 'P5',
      measureMxl: '77',
      noteIndex: 28,
      articulation: 'accent',
      placement: 'below' as const,
      distance: '5',
      pitchStep: 'A',
      pitchOctave: 3,
      staff: 2,
    },
  ];
  const filtered = plOnlyPreviewXml(twoStaffXml());
  const loadXml = applyArticulationPlacementFixesToPreviewXml(
    prepareArticulationDefaultYForOsmdPreview(repairTimelineForOsmdPreview(filtered)),
    fixes,
  );
  if ((loadXml.match(/<tenuto/g) || []).length !== 1) {
    throw new Error(`expected tenuto on exactly one note, got ${(loadXml.match(/<tenuto/g) || []).length}`);
  }
  if ((loadXml.match(/<accent/g) || []).length !== 1) {
    throw new Error(`expected accent on exactly one note, got ${(loadXml.match(/<accent/g) || []).length}`);
  }

  const osmd = new OSMD(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    useXMLMeasureNumbers: true,
  });
  registerOsmdPreviewXmlForArticulation(osmd, loadXml);
  registerOsmdArticulationFixes(osmd, fixes);
  await osmd.load(loadXml);
  osmd.render();
  applyOsmdArticulationOffsetsDetailed(host, osmd);

  const stray = [...host.querySelectorAll('[data-hitl-art-overlay], [data-hitl-art-tag], text')].filter((el) => {
    const t = (el.textContent || '').trim();
    const tag = el.getAttribute('data-hitl-art-overlay') || el.getAttribute('data-hitl-art-tag') || '';
    if (el.getAttribute('data-hitl-art-hidden') === '1') return false;
    const op = (el as SVGElement).style?.opacity ?? el.getAttribute('opacity');
    if (op === '0') return false;
    return t === '·' || t === '.' || t === ',' || tag === 'staccato' || tag === 'breath-mark';
  });
  if (stray.length) {
    throw new Error(
      `PL add tenuto/accent left stray dot-like overlay: ${stray.map((e) => `${e.getAttribute('data-hitl-art-tag')}=${e.textContent}`).join(',')}`,
    );
  }

  const staves = [...host.querySelectorAll('.vf-stavenote')];
  if (staves.length < 2) throw new Error(`expected ≥2 stavenotes, got ${staves.length}`);
  const halfX = noteHeadX(staves[0]!);
  const chordX = noteHeadX(staves[staves.length - 1]!);
  if (halfX == null || chordX == null) throw new Error('missing noteheads');

  const overlaysOnChord = [...host.querySelectorAll('[data-hitl-art-overlay]')].filter((el) => {
    if (el.getAttribute('data-hitl-art-hidden') === '1') return false;
    const op = (el as SVGElement).style?.opacity ?? el.getAttribute('opacity');
    if (op === '0') return false;
    const x = parseFloat(el.getAttribute('x') || '');
    if (!Number.isFinite(x)) return false;
    return Math.abs(x - chordX) + 4 < Math.abs(x - halfX);
  });
  if (overlaysOnChord.length) {
    throw new Error(
      `ghost overlay on following PL chord: ${overlaysOnChord.map((e) => `${e.getAttribute('data-hitl-art-overlay')}=${e.textContent}@${e.getAttribute('x')}`).join(',')}`,
    );
  }

  const fallbackY = [...host.querySelectorAll('[data-hitl-art-overlay]')].filter((el) => {
    const y = parseFloat(el.getAttribute('y') || '');
    return Number.isFinite(y) && y > 0 && y < 45;
  });
  if (fallbackY.length) {
    throw new Error(`art overlay parked on the staff (y<45): ${fallbackY.map((e) => e.getAttribute('y')).join(',')}`);
  }

  console.log('PL add art no-dot-ghost OK', {
    debug: host.getAttribute('data-hitl-art-debug'),
    halfX,
    chordX,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
