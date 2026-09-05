/**
 * c0b3 m50 PL: faithful play-order realign이 bass half를 잘라 C3→A3 슬러 bezier가
 * 뒤집히지 않는지 확인.
 * Prep: python extracts review → _smoke/_c0b3_score.xml (or skip if missing)
 * Run: npx tsx _smoke/test_c0b3_m50_pl_slur_bezier.ts
 */
import { JSDOM } from 'jsdom';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import {
  repairTimelineForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup.ts';
import { pruneCrossStaffTimelineForOsmdPreview as pruneStaff } from '../shared/musicXmlStaffPreview.ts';
import {
  measureHasExplicitPlayOrder,
  measureHasMidClefAttributes,
  reorderMeasureNotesByPlayOrderForOsmdPreview,
} from '../shared/musicXmlPlayOrder.ts';
import { anchorTrailingMidClefsInMeasure } from '../shared/musicXmlMidClefOsmdAnchor.ts';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse.ts';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
});

function ensureScore(): string {
  const path = '_smoke/_c0b3_score.xml';
  if (existsSync(path)) return path;
  if (!existsSync('omr-work-c0b3c9ba.zip')) {
    console.log('skip: no omr-work-c0b3c9ba.zip');
    process.exit(0);
  }
  execSync(
    `python -c "import zipfile,tempfile,sys; from pathlib import Path; sys.path.insert(0,'scripts'); from omr_hitl_lib import load_mxl_root; td=Path(tempfile.mkdtemp()); zipfile.ZipFile('omr-work-c0b3c9ba.zip').extractall(td); files,rp,_=load_mxl_root(next(td.rglob('review.mxl'))); Path('_smoke/_c0b3_score.xml').write_bytes(files[rp])"`,
    { stdio: 'inherit' },
  );
  return path;
}

function local(el: Element): string {
  return el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
}
function noteStaffN(note: Element): number {
  const t = [...note.children].find((c) => local(c) === 'staff')?.textContent?.trim();
  return parseInt(t || '1', 10) || 1;
}

function filterPartStaff(xml: string, partId: string, staffN: number): string {
  const doc = parseMusicXmlDocument(xml)!;
  for (const part of [...doc.getElementsByTagName('part')]) {
    if (part.getAttribute('id') !== partId) {
      part.remove();
      continue;
    }
    for (const measure of [...part.children].filter((c) => local(c) === 'measure')) {
      for (const child of [...measure.children]) {
        if (local(child) === 'note' && noteStaffN(child) !== staffN) child.remove();
      }
      pruneStaff(measure, staffN);
      snapshotNoteDefaultXForOsmdPreview(measure);
      reorderMeasureNotesByPlayOrderForOsmdPreview(measure);
      if (
        !measureHasExplicitPlayOrder(measure, staffN) &&
        !measureHasMidClefAttributes(measure, staffN)
      ) {
        reorderSingleStaffTimelineByOnsetForOsmdPreview(measure);
      }
      normalizeMultiVoiceLayersForOsmdPreview(measure);
      realignMeasureDefaultXFromTimelineForOsmd(measure);
      measure.querySelectorAll('note staff, note *|staff').forEach((el) => {
        el.textContent = '1';
      });
      anchorTrailingMidClefsInMeasure(measure);
    }
  }
  const partList = doc.getElementsByTagName('part-list')[0];
  if (partList) {
    for (const sp of [...partList.children]) {
      if (local(sp) === 'score-part' && sp.getAttribute('id') !== partId) sp.remove();
    }
  }
  return serializeMusicXmlDocument(doc);
}

const scorePath = ensureScore();
let xml = readFileSync(scorePath, 'utf8');
xml = repairTimelineForOsmdPreview(xml, { faithfulEditorLayout: true });
xml = filterPartStaff(xml, 'P5', 2);
xml = repairTimelineForOsmdPreview(xml, { faithfulEditorLayout: true });

const doc = parseMusicXmlDocument(xml)!;
const m50 = [...doc.getElementsByTagName('measure')].find((m) => m.getAttribute('number') === '50')!;
let f1Dur = '';
for (const n of [...m50.children].filter((c) => local(c) === 'note')) {
  const pitch = [...n.children].find((c) => local(c) === 'pitch');
  const step = pitch && [...pitch.children].find((c) => local(c) === 'step')?.textContent;
  const oct = pitch && [...pitch.children].find((c) => local(c) === 'octave')?.textContent;
  if (`${step}${oct}` === 'F1') {
    f1Dur = [...n.children].find((c) => local(c) === 'duration')?.textContent || '';
  }
}
if (f1Dur !== '8') {
  console.error(`FAIL F1 duration ${f1Dur}, want 8 (half must not be trimmed)`);
  process.exit(1);
}

for (const part of [...doc.getElementsByTagName('part')]) {
  for (const m of [...part.children].filter((c) => local(c) === 'measure')) {
    if (m.getAttribute('number') !== '50') m.remove();
  }
}
const slim = serializeMusicXmlDocument(doc);
writeFileSync('_smoke/_c0b3_m50_pl_preview.xml', slim);

const osm: any = await import('opensheetmusicdisplay');
const OSMD = osm.OpenSheetMusicDisplay || osm.default?.OpenSheetMusicDisplay;
const host = document.createElement('div');
host.style.width = '1200px';
document.body.appendChild(host);
const osmd = new OSMD(host, { autoResize: false, drawTitle: false });
await osmd.load(slim);
osmd.render();

const spans: number[] = [];
for (const page of osmd.GraphicSheet.MusicPages) {
  for (const sys of page.MusicSystems) {
    for (const sl of sys.StaffLines) {
      for (const gs of sl.GraphicalSlurs || []) {
        spans.push(gs.bezierEndPt.x - gs.bezierStartPt.x);
      }
    }
  }
}
if (spans.length < 2) {
  console.error('FAIL expected 2 graphical slurs', spans);
  process.exit(1);
}
if (spans.some((s) => s < 0)) {
  console.error('FAIL backwards slur bezier', spans);
  process.exit(1);
}
console.log('OK c0b3 m50 PL slur beziers forward', spans.map((s) => +s.toFixed(2)));
