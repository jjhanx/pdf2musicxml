/**
 * cresc. words (OSMD verbal continuous dynamic) stay centered on the attached note.
 * npx tsx _smoke/test_verbal_cresc_on_attached_note.ts
 */
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';
import { anchorVerbalDynamicLabelsToNoteheads } from '../src/osmdOnsetColumnAlignFix';

const require = createRequire(import.meta.url);
const { OpenSheetMusicDisplay } = require('opensheetmusicdisplay') as {
  OpenSheetMusicDisplay: new (host: HTMLElement, opts: object) => {
    load: (xml: string) => Promise<void>;
    render: () => void;
    zoom: number;
  };
};

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
const hostEl = dom.window.document.getElementById('host') as HTMLElement;
Object.defineProperty(hostEl, 'clientWidth', { value: 900, configurable: true });
Object.defineProperty(hostEl, 'offsetWidth', { value: 900, configurable: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0),
});

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>T</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>-1</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><rest/><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <direction placement="above" default-y="10">
        <direction-type><words default-y="10">cresc.</words></direction-type>
        <voice>1</voice>
      </direction>
      <note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type></note>
    </measure>
  </part>
</score-partwise>`;

function userX(el: Element, localX: number): number {
  let tx = 0;
  let cur: Element | null = el;
  while (cur) {
    const tm = /translate\(\s*([-\d.]+)/.exec(cur.getAttribute('transform') ?? '');
    if (tm) tx += parseFloat(tm[1]!);
    cur = cur.parentElement;
  }
  return tx + localX;
}

function noteXs(osmd: { GraphicSheet: { MeasureList: unknown[][] } }): Array<{ ht: number; x: number }> {
  const gm = osmd.GraphicSheet.MeasureList[0]?.[0] as {
    staffEntries?: Array<{
      graphicalVoiceEntries?: Array<{
        notes?: Array<{
          sourceNote?: { halfTone?: number; isRest?: boolean };
          getSVGGElement?: () => Element | null;
        }>;
      }>;
    }>;
  };
  const xs: Array<{ ht: number; x: number }> = [];
  for (const se of gm.staffEntries || []) {
    for (const ve of se.graphicalVoiceEntries || []) {
      for (const n of ve.notes || []) {
        const ht = n.sourceNote?.halfTone;
        if (ht == null || ht > 80) continue;
        const svg = n.getSVGGElement?.();
        const path = svg?.querySelector('.vf-notehead path');
        const d = path?.getAttribute('d') ?? '';
        const m = /^M\s*([-\d.]+)/.exec(d.trim());
        if (path && m) xs.push({ ht, x: userX(path, parseFloat(m[1]!)) });
      }
    }
  }
  return xs;
}

function crescBox(osmd: { GraphicSheet: { MusicPages: unknown[] } }): { left: number; width: number } | null {
  const page = osmd.GraphicSheet.MusicPages[0] as {
    MusicSystems?: Array<{ StaffLines?: Array<{ AbstractExpressions?: unknown[] }> }>;
  };
  for (const sys of page.MusicSystems || []) {
    for (const sl of sys.StaffLines || []) {
      for (const raw of sl.AbstractExpressions || []) {
        const expr = raw as {
          IsVerbal?: boolean;
          Label?: { SVGNode?: Element; PositionAndShape?: { Size?: { width: number } } };
        };
        if (expr.IsVerbal !== true) continue;
        const text = expr.Label?.SVGNode?.querySelector?.('text') ?? (expr.Label?.SVGNode as Element | undefined);
        if (!text || text.tagName?.toLowerCase() !== 'text') continue;
        const x = parseFloat(text.getAttribute('x') ?? '');
        const w = expr.Label?.PositionAndShape?.Size?.width ?? 0;
        if (!Number.isFinite(x) || w <= 0) continue;
        return { left: userX(text, x), width: w * 10 };
      }
    }
  }
  return null;
}

async function main(): Promise<void> {
  const osmd = new OpenSheetMusicDisplay(hostEl, { autoResize: false, backend: 'svg', drawTitle: false });
  osmd.zoom = 1;
  await osmd.load(xml);
  osmd.render();
  const before = crescBox(osmd as never);
  const pitches = noteXs(osmd as never);
  const bbN = pitches.find((n) => n.ht === 46);
  const c4N = pitches.filter((n) => n.ht === 48)[1];
  if (!before || !bbN || !c4N) {
    console.error('missing cresc or notes', before, pitches);
    process.exit(1);
  }
  const bb = bbN.x;
  const c4 = c4N.x;
  const beforeCenter = before.left + before.width / 2;
  console.log('before', { left: before.left, width: before.width, center: beforeCenter, bb, c4 });
  anchorVerbalDynamicLabelsToNoteheads(osmd as never);
  const after = crescBox(osmd as never);
  if (!after) {
    console.error('cresc missing after shift');
    process.exit(1);
  }
  const center = after.left + after.width / 2;
  const right = after.left + after.width;
  console.log('after', { left: after.left, center, right, bb, c4 });
  const closerToBb = Math.abs(center - bb) < Math.abs(center - c4);
  const endsBeforeNext = right < c4 - 1;
  if (!closerToBb || !endsBeforeNext) {
    console.error('FAIL cresc not on Bb3', { center, right, bb, c4 });
    process.exit(1);
  }
  anchorVerbalDynamicLabelsToNoteheads(osmd as never);
  const again = crescBox(osmd as never);
  if (!again || Math.abs(again.left - after.left) > 0.6) {
    console.error('FAIL second pass moved', again, after);
    process.exit(1);
  }
  console.log('OK verbal cresc centered on attached note');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
