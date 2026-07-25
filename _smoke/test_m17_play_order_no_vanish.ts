/**
 * m17 PR: play order 2 on F4+E5 — notes must survive dedupe + OSMD (no vanish).
 * Run: npx tsx _smoke/test_m17_play_order_no_vanish.ts
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import osmdLib from 'opensheetmusicdisplay';
import {
  repairTimelineForOsmdPreview,
  snapshotNoteDefaultXForOsmdPreview,
  reorderSingleStaffTimelineByOnsetForOsmdPreview,
  normalizeMultiVoiceLayersForOsmdPreview,
  realignMeasureDefaultXFromTimelineForOsmd,
} from '../shared/musicXmlTimelineCleanup';
import { pruneCrossStaffTimelineForOsmdPreview } from '../shared/musicXmlStaffPreview';
import { unifyVoiceForSamePlayOrderPreview } from '../shared/musicXmlPlayOrder';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => unknown } }).default?.OpenSheetMusicDisplay;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="host"></div></body></html>');
Object.assign(globalThis, {
  document: dom.window.document,
  window: dom.window,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
});

const local = (el: Element) => el.localName?.toLowerCase() ?? el.tagName.toLowerCase();
const pitch = (n: Element) => {
  const step = n.querySelector('step,*|step')?.textContent ?? '';
  const oct = n.querySelector('octave,*|octave')?.textContent ?? '';
  const alter = n.querySelector('alter,*|alter')?.textContent?.trim();
  return `${step}${alter === '-1' ? 'b' : ''}${oct}`;
};

function leaderPitches(m17: Element): string[] {
  const out: string[] = [];
  for (const c of [...m17.children]) {
    if (local(c) !== 'note' || c.querySelector('chord,*|chord')) continue;
    out.push(pitch(c));
  }
  return out;
}

function chordMemberPitches(m17: Element): string[] {
  const out: string[] = [];
  for (const c of [...m17.children]) {
    if (local(c) !== 'note') continue;
    out.push(`${pitch(c)}${c.querySelector('chord,*|chord') ? '*' : ''}`);
  }
  return out;
}

function buildM17(raw: string): Element {
  let xml = repairTimelineForOsmdPreview(raw);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const part = [...doc.querySelectorAll('part,*|part')].find((p) => p.getAttribute('id') === 'P5')!;
  const m17 = [...part.children].find((c) => local(c) === 'measure' && c.getAttribute('number') === '17') as Element;
  for (const child of [...m17.children]) {
    if (local(child) === 'note') {
      const st = child.querySelector('staff,*|staff')?.textContent?.trim();
      if (st && st !== '1') child.remove();
    }
  }
  m17.querySelectorAll('note staff,note *|staff').forEach((el) => { el.textContent = '1'; });
  pruneCrossStaffTimelineForOsmdPreview(m17, 1);
  snapshotNoteDefaultXForOsmdPreview(m17);
  reorderSingleStaffTimelineByOnsetForOsmdPreview(m17);
  normalizeMultiVoiceLayersForOsmdPreview(m17);
  unifyVoiceForSamePlayOrderPreview(m17);
  realignMeasureDefaultXFromTimelineForOsmd(m17);
  return m17;
}

async function osmdStavenoteCount(m17: Element): Promise<number> {
  const attrs = [...m17.children].find((c) => local(c) === 'attributes');
  const clef = '<clef><sign>G</sign><line>2</line></clef>';
  const wrapAttrs = attrs
    ? attrs.outerHTML.replace('</attributes>', `${clef}</attributes>`)
    : `<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type>${clef}</attributes>`;
  const preview = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P5"><part-name/></score-part></part-list><part id="P5"><measure number="17">${wrapAttrs}${[...m17.children].filter((c) => local(c) !== 'attributes').map((c) => c.outerHTML).join('')}</measure></part></score-partwise>`;
  const host = document.getElementById('host')!;
  host.innerHTML = '';
  const osmd = new OSMD!(host, { autoResize: true, backend: 'svg', drawMeasureNumbers: false });
  await (osmd as { load: (x: string) => Promise<void> }).load(preview);
  (osmd as { render: () => void }).render();
  return host.querySelectorAll('.vf-stavenote,.vf-staveNote').length;
}

async function main() {
  if (!fs.existsSync('omr-work-0ea5ea52.zip')) {
    console.log('skip');
    return;
  }
  const raw = execSync('python _smoke/_export_m17_play_order2.py', { encoding: 'utf8', maxBuffer: 20e6 });
  const m17 = buildM17(raw);
  const leaders = leaderPitches(m17);
  const members = chordMemberPitches(m17);
  const requiredLeaders = ['F4', 'E5', 'F5', 'G4'];
  for (const p of requiredLeaders) {
    if (!leaders.includes(p)) throw new Error(`missing leader ${p} got ${leaders.join(' ')}`);
  }
  if (!members.some((m) => m.startsWith('Bb4'))) throw new Error(`missing Bb4 chord member got ${members.join(' ')}`);
  if (!members.some((m) => m.startsWith('D5'))) throw new Error(`missing D5 chord member got ${members.join(' ')}`);
  if (!members.some((m) => m.startsWith('E5*'))) throw new Error(`missing trailing E5 chord got ${members.join(' ')}`);
  if (!members.some((m) => m.startsWith('C5*'))) throw new Error(`missing C5 chord got ${members.join(' ')}`);
  if (!members.some((m) => m.startsWith('G5*'))) throw new Error(`missing G5 chord got ${members.join(' ')}`);

  const f4 = [...m17.children].find((c) => local(c) === 'note' && pitch(c) === 'F4' && !c.querySelector('chord,*|chord')) as Element;
  const e5 = [...m17.children].find((c) => local(c) === 'note' && pitch(c) === 'E5' && !c.querySelector('chord,*|chord')) as Element;
  if (f4.getAttribute('default-x') !== e5.getAttribute('default-x')) {
    throw new Error('F4/E5 must share default-x column');
  }

  const staves = await osmdStavenoteCount(m17);
  if (staves < 4) throw new Error(`expected >=4 OSMD stavenotes got ${staves}`);

  console.log('OK m17 play order no vanish', { leaders, staves });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
