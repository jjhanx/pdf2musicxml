/**
 * 대기 보정 → 미리보기 XML → OSMD SVG shift end-to-end.
 * Run: npx tsx _smoke/test_articulation_pending_preview.ts
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { mergeFix, newFixId, type OmrHitlFix } from '../src/omrHitlFixes';
import { registerOsmdPreviewXmlForAlign } from '../src/osmdOnsetColumnAlignFix';
import {
  applyOsmdArticulationOffsetsDetailed,
  registerOsmdArticulationFixes,
  registerOsmdPreviewXmlForArticulation,
  staffSpacePxFromHost,
} from '../src/osmdArticulationOffsetFix';
import {
  applyArticulationPlacementFixesToPreviewXml,
  HITL_ART_DISTANCE_ATTR,
} from '../shared/musicXmlArticulationDistance';
import {
  prepareArticulationDefaultYForOsmdPreview,
  repairTimelineForOsmdPreview,
} from '../shared/musicXmlTimelineCleanup';
import { parseMusicXmlDocument } from '../shared/musicXmlParse';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;
if (!OSMD) throw new Error('OSMD missing');

function simulateAddFix(prev: OmrHitlFix[], fix: OmrHitlFix): OmrHitlFix[] {
  const next = mergeFix(prev, fix);
  if (next === prev) return prev;
  return next;
}

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
      return { x: 0, y: 0, width: 10, height: 10 } as DOMRect;
    };
  }
  return dom;
}

function extractM19P5(full: string): string {
  const mStart = full.indexOf('<measure number="19"');
  if (mStart < 0) throw new Error('measure 19 not found');
  const mEnd = full.indexOf('</measure>', mStart);
  const measure = full.slice(mStart, mEnd + 10);
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5">${measure}</part></score-partwise>`;
}

function findAccentNoteIndex(xml: string): number {
  const doc = parseMusicXmlDocument(xml);
  if (!doc) throw new Error('xml parse failed');
  const part = [...doc.documentElement.children].find((c) => c.localName === 'part');
  const measure =
    [...(part?.children ?? [])].find(
      (c) => c.localName === 'measure' && c.getAttribute('number')?.trim() === '19',
    ) ?? [...(part?.children ?? [])].find((c) => c.localName === 'measure');
  if (!measure) throw new Error('measure missing');
  const notes = [...measure.children].filter((c) => c.localName === 'note');
  const idx = notes.findIndex((n) =>
    [...n.children].some(
      (nots) =>
        nots.localName === 'notations' &&
        [...nots.children].some(
          (a) => a.localName === 'articulations' && [...a.children].some((x) => x.localName === 'accent'),
        ),
    ),
  );
  if (idx < 0) throw new Error('accent note not found');
  return idx;
}

async function osmdShiftY(xml: string): Promise<{ shiftY: number; shifted: number; staffPx: number }> {
  const dom = setupDom();
  const host = dom.window.document.createElement('div');
  host.style.width = '900px';
  host.style.height = '600px';
  dom.window.document.body.appendChild(host);

  const repaired = repairTimelineForOsmdPreview(xml);
  registerOsmdPreviewXmlForAlign(
    new OSMD(host, { autoResize: false, backend: 'svg' }),
    repaired,
  );
  const osmd = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
  registerOsmdPreviewXmlForAlign(osmd, repaired);
  registerOsmdPreviewXmlForArticulation(osmd, xml);
  await osmd.load(prepareArticulationDefaultYForOsmdPreview(repaired));
  await osmd.render();

  const stats = applyOsmdArticulationOffsetsDetailed(host, osmd);
  const mods = [...host.querySelectorAll('.vf-modifiers[data-art-shift-y]')];
  const shiftYs = mods.map((m) => parseFloat(m.getAttribute('data-art-shift-y') ?? '0'));
  const maxShift = shiftYs.length ? Math.max(...shiftYs) : 0;
  host.remove();
  return { shiftY: maxShift, shifted: stats.shifted, staffPx: stats.staffSpacePx };
}

async function main() {
  setupDom();

  // 1) addFix 시 거리 변경이 pending에 반영되는지 (옛 버그: length 같으면 skip)
  const baseFix: OmrHitlFix = {
    id: newFixId(),
    kind: 'setArticulationPlacement',
    partId: 'P5',
    measureMxl: '19',
    noteIndex: 3,
    articulation: 'accent',
    placement: 'below',
    distance: 'auto',
  };
  let pending = simulateAddFix([], baseFix);
  if (pending.length !== 1 || pending[0]!.distance !== 'auto') {
    throw new Error('initial pending failed');
  }
  pending = simulateAddFix(pending, {
    ...baseFix,
    id: newFixId(),
    distance: '5',
  });
  if (pending.length !== 1 || pending[0]!.distance !== '5') {
    throw new Error(`pending distance update failed: got ${pending[0]?.distance}`);
  }
  console.log('pending fix merge ok');

  // 0) noteIndex는 분할 전 part 순번. PR만 남은 XML에 그대로 쓰면 앞쪽 악센트에 붙음.
  {
    const twoStaff = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name>P</part-name></score-part></part-list><part id="P5"><measure number="19"><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff><notations><articulations><accent placement="below"/></articulations></notations></note><note><pitch><step>A</step><octave>1</octave></pitch><duration>1</duration><type>quarter</type><staff>2</staff><notations><articulations><accent placement="below"/></articulations></notations></note><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff><notations><articulations><accent placement="below"/></articulations></notations></note></measure></part></score-partwise>`;
    const prOnly = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5__PR"><part-name>PR</part-name></score-part></part-list><part id="P5__PR"><measure number="19"><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff><notations><articulations><accent placement="below"/></articulations></notations></note><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration><type>quarter</type><staff>1</staff><notations><articulations><accent placement="below"/></articulations></notations></note></measure></part></score-partwise>`;
    const fixFs: OmrHitlFix = {
      id: newFixId(),
      kind: 'setArticulationPlacement',
      partId: 'P5',
      measureMxl: '19',
      noteIndex: 2,
      articulation: 'accent',
      placement: 'below',
      distance: '5',
    };
    const distOn = (xml: string, step: string, oct: string, alter: string | null) => {
      const doc = parseMusicXmlDocument(xml);
      if (!doc) return null;
      for (const note of [...doc.querySelectorAll('note')]) {
        const p = note.querySelector('pitch');
        if (!p) continue;
        if (p.querySelector('step')?.textContent !== step) continue;
        if (p.querySelector('octave')?.textContent !== oct) continue;
        const a = p.querySelector('alter')?.textContent ?? null;
        if ((alter ?? null) !== a) continue;
        return note.querySelector('accent')?.getAttribute(HITL_ART_DISTANCE_ATTR) ?? null;
      }
      return undefined;
    };
    const patchedRaw = applyArticulationPlacementFixesToPreviewXml(twoStaff, [fixFs]);
    if (distOn(patchedRaw, 'F', '4', '1') !== '5') {
      throw new Error(`raw noteIndex=2 should set F#4, got ${distOn(patchedRaw, 'F', '4', '1')}`);
    }
    if (distOn(patchedRaw, 'G', '4', null) === '5') {
      throw new Error('raw patch must not set earlier G4 accent');
    }
    const patchedPr = applyArticulationPlacementFixesToPreviewXml(prOnly, [fixFs]);
    if (distOn(patchedPr, 'G', '4', null) === '5' && distOn(patchedPr, 'F', '4', '1') !== '5') {
      console.log('after-PR-split without pitch: noteIndex=2 wrongly hits first accent G4 (regression case)');
    }
    const withPitch = applyArticulationPlacementFixesToPreviewXml(prOnly, [
      { ...fixFs, pitchStep: 'F', pitchOctave: 4, pitchAlter: 1 },
    ]);
    if (distOn(withPitch, 'F', '4', '1') !== '5') {
      throw new Error(`pitch match on PR-only should set F#4, got ${distOn(withPitch, 'F', '4', '1')}`);
    }
    if (distOn(withPitch, 'G', '4', null) === '5') {
      throw new Error('pitch match on PR-only must not set G4');
    }
    console.log('split-safe articulation distance patch ok');
  }

  // 2) pending → raw MXL patch → buildOsmdPreviewXml (실제 UI 파이프라인)
  let raw = extractM19P5(fs.readFileSync('_smoke/_diag_p5_auto.xml', 'utf8'));
  const noteIdx = findAccentNoteIndex(raw);
  const fix5 = { ...baseFix, noteIndex: noteIdx, distance: '5' };
  raw = applyArticulationPlacementFixesToPreviewXml(raw, [fix5]);
  if (!raw.includes(`${HITL_ART_DISTANCE_ATTR}="5"`)) {
    throw new Error('raw preview xml patch missing distance=5');
  }
  console.log('raw preview xml patch ok', { noteIdx });

  // 3) auto vs 5칸 SVG shift (실제 m19)
  const autoXml = extractM19P5(fs.readFileSync('_smoke/_diag_p5_auto.xml', 'utf8'));
  const fiveRaw = applyArticulationPlacementFixesToPreviewXml(autoXml, [fix5]);
  const auto = await osmdShiftY(autoXml);
  const five = await osmdShiftY(fiveRaw);
  console.log('osmd shift', { auto, five });

  if (auto.shifted === 0 || five.shifted === 0) {
    throw new Error(`shifted=0 auto=${auto.shifted} five=${five.shifted}`);
  }
  if (five.shiftY <= auto.shiftY) {
    throw new Error(`5칸(${five.shiftY}) should exceed auto(${auto.shiftY})`);
  }
  if (auto.staffPx < 3 || five.staffPx < 3) {
    throw new Error(`staffPx too small: ${auto.staffPx}`);
  }

  // 4) OSMD 재로드 없이 hint XML만 바꿔 SVG shift (실제 UI 경로)
  {
    const dom = setupDom();
    const host = dom.window.document.createElement('div');
    host.style.width = '900px';
    host.style.height = '600px';
    dom.window.document.body.appendChild(host);
    const repaired = repairTimelineForOsmdPreview(autoXml);
    const osmd = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
    registerOsmdPreviewXmlForAlign(osmd, repaired);
    registerOsmdPreviewXmlForArticulation(osmd, autoXml);
    await osmd.load(prepareArticulationDefaultYForOsmdPreview(repaired));
    await osmd.render();
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    const yAuto = Math.max(
      0,
      ...[...host.querySelectorAll('[data-art-shift-y]')].map((el) =>
        parseFloat(el.getAttribute('data-art-shift-y') ?? '0'),
      ),
    );
    registerOsmdPreviewXmlForArticulation(osmd, fiveRaw);
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    const yFive = Math.max(
      0,
      ...[...host.querySelectorAll('[data-art-shift-y]')].map((el) =>
        parseFloat(el.getAttribute('data-art-shift-y') ?? '0'),
      ),
    );
    host.remove();
    console.log('reapply without reload', { yAuto, yFive });
    if (yFive <= yAuto) {
      throw new Error(`reapply 5칸(${yFive}) should exceed auto(${yAuto})`);
    }
  }

  // 5) XML은 auto 그대로, pending fix overlay만으로 5칸 이동 (스태프 필터 빗나감 대비)
  {
    const dom = setupDom();
    const host = dom.window.document.createElement('div');
    host.style.width = '900px';
    host.style.height = '600px';
    dom.window.document.body.appendChild(host);
    const repaired = repairTimelineForOsmdPreview(autoXml);
    const osmd = new OSMD(host, { autoResize: false, backend: 'svg', drawTitle: false });
    registerOsmdPreviewXmlForAlign(osmd, repaired);
    registerOsmdPreviewXmlForArticulation(osmd, autoXml);
    registerOsmdArticulationFixes(osmd, []);
    await osmd.load(prepareArticulationDefaultYForOsmdPreview(repaired));
    await osmd.render();
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    const yAuto = Math.max(
      0,
      ...[...host.querySelectorAll('[data-art-shift-y]')].map((el) =>
        parseFloat(el.getAttribute('data-art-shift-y') ?? '0'),
      ),
    );
    registerOsmdArticulationFixes(osmd, [
      {
        kind: 'setArticulationPlacement',
        partId: 'P5',
        measureMxl: '19',
        noteIndex: noteIdx,
        articulation: 'accent',
        placement: 'below',
        distance: '5',
        pitchStep: 'F',
        pitchOctave: 4,
        pitchAlter: 1,
      },
    ]);
    applyOsmdArticulationOffsetsDetailed(host, osmd);
    const yFive = Math.max(
      0,
      ...[...host.querySelectorAll('[data-art-shift-y]')].map((el) =>
        parseFloat(el.getAttribute('data-art-shift-y') ?? '0'),
      ),
    );
    host.remove();
    console.log('overlay fixes without xml patch', { yAuto, yFive });
    if (yFive <= yAuto) {
      throw new Error(`overlay 5칸(${yFive}) should exceed auto(${yAuto})`);
    }
  }

  console.log('articulation pending preview e2e ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
