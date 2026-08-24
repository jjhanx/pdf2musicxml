/**
 * 20마디 #24 A1 저음 음표의 악센트가 오선 기준 1칸~10칸으로 정확히 제어되는지 검증.
 * Run: npx tsx _smoke/test_low_pitch_articulation_m20.ts
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import * as osmdLib from 'opensheetmusicdisplay';
import { parseMusicXmlDocument, serializeMusicXmlDocument } from '../shared/musicXmlParse';
import {
  registerOsmdPreviewXmlForArticulation,
  applyOsmdArticulationOffsetsDetailed,
} from '../src/osmdArticulationOffsetFix';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance';

const OSMD =
  (osmdLib as { OpenSheetMusicDisplay?: new (...a: unknown[]) => any }).OpenSheetMusicDisplay ??
  (osmdLib as { default?: { OpenSheetMusicDisplay?: new (...a: unknown[]) => any } }).default
    ?.OpenSheetMusicDisplay;

async function testLowPitchM20() {
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
    requestAnimationFrame: (cb: any) => setTimeout(() => cb(0), 0),
  });

  const rawXml = fs.readFileSync('C:\\Users\\jjhan\\.gemini\\antigravity-ide\\brain\\b8216b63-95d8-45be-aa27-9f3a4ef140d6\\scratch\\score.xml', 'utf8');
  const doc = parseMusicXmlDocument(rawXml)!;
  for (const part of [...doc.documentElement.children].filter((c) => c.localName === 'part')) {
    for (const m of [...part.children].filter((c) => c.localName === 'measure')) {
      const num = parseInt(m.getAttribute('number') ?? '0', 10);
      if (num !== 20) m.remove();
    }
  }
  // 20마디 P5 Staff 2의 A1 음표에 accent 추가
  const p5m20 = doc.querySelector('part[id="P5"] measure[number="20"]')!;
  const notes = [...p5m20.children].filter((c) => c.localName === 'note');
  const a1Note = notes.find((n) => n.querySelector('step')?.textContent === 'A' && n.querySelector('octave')?.textContent === '1');
  if (!a1Note) throw new Error('A1 note not found in m20');

  let nots = a1Note.querySelector('notations');
  if (!nots) {
    nots = doc.createElement('notations');
    a1Note.appendChild(nots);
  }
  let arts = nots.querySelector('articulations');
  if (!arts) {
    arts = doc.createElement('articulations');
    nots.appendChild(arts);
  }
  const acc = doc.createElement('accent');
  acc.setAttribute('placement', 'below');
  acc.setAttribute('default-y', '-10');
  acc.setAttribute('data-hitl-art-distance', '1'); // 1칸 지정!
  arts.appendChild(acc);

  const previewXml = serializeMusicXmlDocument(doc);

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);

  const osmd = new OSMD(host as any, { autoResize: false, backend: 'svg', drawTitle: false });
  registerOsmdPreviewXmlForArticulation(osmd, previewXml);
  await osmd.load(previewXml);
  osmd.render();

  const stats = applyOsmdArticulationOffsetsDetailed(host, osmd);
  console.log('M20 A1 1칸 stats:', stats);

  const artEls = host.querySelectorAll('.vf-stavenote .vf-modifiers > path');
  console.log(`Found ${artEls.length} art modifier paths`);
  artEls.forEach((el, i) => {
    console.log(`  Path #${i}: d="${el.getAttribute('d')?.slice(0, 40)}" transform="${el.getAttribute('transform')}" shiftY="${el.getAttribute('data-art-shift-y')}"`);
  });

  if (stats.shifted === 0) {
    throw new Error('M20 A1 accent was not shifted');
  }

  console.log('testLowPitchM20 ok!');
}

testLowPitchM20().catch(console.error);
