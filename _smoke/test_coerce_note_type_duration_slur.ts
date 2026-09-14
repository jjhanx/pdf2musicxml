/**
 * type=half + duration=eighth-length: keep half glyph, fix duration → un-invert slur.
 * Run: npx tsx _smoke/test_coerce_note_type_duration_slur.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import {
  coerceNoteDurationsToTypeForOsmdPreview,
  repairMissingNoteTypesForOsmdPreview,
} from '../shared/musicXmlRestDisplay';

const OpenSheetMusicDisplay =
  (osmdLib as any).OpenSheetMusicDisplay ?? (osmdLib as any).default?.OpenSheetMusicDisplay;

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="h" style="width:1200px;height:500px"></div></body></html>',
  { pretendToBeVisual: true },
);
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
});
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get: () => 1200 });
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get: () => 500 });

// --- unit: half stays half; duration 2 → 8 ---
const unitXml = `<?xml version="1.0"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name/></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>F</step><octave>1</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>
      <note><pitch><step>B</step><octave>1</octave></pitch><duration>6</duration><voice>1</voice><type>quarter</type><dot/></note>
    </measure>
  </part>
</score-partwise>`;
const coerced = coerceNoteDurationsToTypeForOsmdPreview(unitXml);
assert.match(coerced, /<type>half<\/type>/);
assert.match(coerced, /<duration>8<\/duration>\s*<voice>1<\/voice>\s*<type>half<\/type>/);
assert.match(coerced, /<duration>6<\/duration>/); // dotted quarter unchanged
assert.doesNotMatch(coerced, /<type>eighth<\/type>/);
console.log('coerce unit ok (duration←type, keep half)');

// --- OSMD: m50 PL keeps half + C3→A3 not inverted ---
spawnSync('venv/Scripts/python.exe', ['_smoke/_build_014f_minimal_slur.py'], {
  encoding: 'utf-8',
  stdio: 'inherit',
});
const raw = readFileSync(join('_smoke/_014f_m50_slur', 'minimal.xml'), 'utf8');
assert.match(raw, /<duration>2<\/duration>\s*<voice>6<\/voice>\s*<type>half<\/type>/);

const fixed = repairMissingNoteTypesForOsmdPreview(raw);
assert.match(fixed, /<duration>8<\/duration>\s*<voice>6<\/voice>\s*<type>half<\/type>/);
assert.doesNotMatch(fixed, /<duration>2<\/duration>\s*<voice>6<\/voice>\s*<type>half<\/type>/);
assert.doesNotMatch(fixed, /<type>eighth<\/type>\s*<stem>down<\/stem>\s*<\/note>\s*<note default-x="82/); // F chord not coerced to 8th

function halfTone(n: any): number | null {
  try {
    const p = (n?.sourceNote ?? n)?.Pitch ?? (n?.sourceNote ?? n)?.pitch;
    return p?.getHalfTone?.() ?? p?.halfTone ?? null;
  } catch {
    return null;
  }
}

async function slurDx(xml: string) {
  const host = document.getElementById('h')!;
  host.innerHTML = '';
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: 'svg',
    drawTitle: false,
    drawPartNames: false,
  });
  await osmd.load(xml);
  osmd.render();
  const out: Array<{ start: number | null; end: number | null; dx: number; inv: boolean }> = [];
  for (const page of (osmd as any).GraphicSheet?.MusicPages ?? []) {
    for (const sys of page.MusicSystems ?? []) {
      for (const sl of sys.StaffLines ?? []) {
        for (const g of sl.GraphicalSlurs ?? []) {
          out.push({
            start: halfTone(g.slur?.StartNote),
            end: halfTone(g.slur?.EndNote),
            dx: g.bezierEndPt.x - g.bezierStartPt.x,
            inv: g.bezierEndPt.x < g.bezierStartPt.x,
          });
        }
      }
    }
  }
  return out;
}

const before = await slurDx(raw);
const broken = before.find((s) => s.start === 36 && s.end === 45);
assert.ok(broken?.inv, 'precondition: raw XML should invert C3→A3');

const after = await slurDx(fixed);
const short = after.find((s) => s.start === 36 && s.end === 45);
const long = after.find((s) => s.start === 40 && s.end === 47);
assert.ok(short && !short.inv && short.dx > 1, `C3→A3 must go L→R: ${JSON.stringify(short)}`);
assert.ok(long && !long.inv && long.dx > 1, `E3→B3 must stay ok: ${JSON.stringify(long)}`);
console.log('coerce OSMD slur ok (half glyph kept)', { short, long });
