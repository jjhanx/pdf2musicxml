/**
 * PR/PL 분할 미리보기 XML: 편집기 noteIndex(원본 part document order)로 온 표 보정이
 * 다른 줄(PL)의 같은 위치 음에 새 표를 만들지 않아야 한다.
 * Run: npx tsx _smoke/test_split_pr_art_fix_not_on_pl.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyArticulationPlacementFixesToPreviewXml } from '../shared/musicXmlArticulationDistance';

const dom = new JSDOM('');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  Node: dom.window.Node,
});

const note = (src: number, step: string, oct: number, extra = '', chord = false) => `
      <note data-hitl-src-note-index="${src}">${chord ? '<chord/>' : ''}
        <pitch><step>${step}</step><octave>${oct}</octave></pitch>
        <duration>6</duration><voice>1</voice><type>eighth</type><staff>1</staff>${extra}
      </note>`;

const accent = '<notations><articulations><accent placement="above" default-y="50"/></articulations></notations>';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P5__PR"><part-name>PR</part-name></score-part>
    <score-part id="P5__PL"><part-name>PL</part-name></score-part>
  </part-list>
  <part id="P5__PR">
    <measure number="45">${note(0, 'A', 5, accent)}${note(1, 'F', 6, '', true)}${note(2, 'G', 5)}</measure>
  </part>
  <part id="P5__PL">
    <measure number="45">${note(22, 'F', 2)}${note(23, 'F', 3, '', true)}${note(24, 'F', 3)}</measure>
  </part>
</score-partwise>`;

function accentsIn(out: string, partId: string): string[] {
  const part = new RegExp(`<part id="${partId}">([\\s\\S]*?)</part>`).exec(out)?.[1] ?? '';
  return [...part.matchAll(/<note\b[\s\S]*?<\/note>/g)]
    .filter((m) => /<accent\b/.test(m[0]))
    .map((m) => {
      const p = /<step>(\w)<\/step>\s*<octave>(\d)/.exec(m[0]);
      return p ? `${p[1]}${p[2]}` : '?';
    });
}

const base = { partId: 'P5', measureMxl: 45, articulation: 'accent', placement: 'above' as const };
const cases: Array<{ name: string; fix: Record<string, unknown>; pr: string[]; pl: string[] }> = [
  { name: 'PR 거리 (noteIndex 0)', fix: { kind: 'setArticulationPlacement', noteIndex: 0, distance: '5' }, pr: ['A5'], pl: [] },
  {
    name: 'PR 거리 + staff/pitch',
    fix: { kind: 'setArticulationPlacement', noteIndex: 0, staffWithinPart: 1, pitchStep: 'A', pitchOctave: 5, distance: '5' },
    pr: ['A5'],
    pl: [],
  },
  { name: 'PR 추가 (noteIndex 2)', fix: { kind: 'addArticulation', noteIndex: 2, staffWithinPart: 1 }, pr: ['A5', 'G5'], pl: [] },
  { name: 'PL 추가 (noteIndex 22)', fix: { kind: 'addArticulation', noteIndex: 22, staffWithinPart: 2 }, pr: ['A5'], pl: ['F2'] },
  { name: 'PR 제거 (noteIndex 0)', fix: { kind: 'removeArticulation', noteIndex: 0, staffWithinPart: 1 }, pr: [], pl: [] },
];

for (const c of cases) {
  const out = applyArticulationPlacementFixesToPreviewXml(xml, [{ ...base, ...c.fix } as never]);
  assert.deepEqual(accentsIn(out, 'P5__PR'), c.pr, `${c.name}: PR`);
  assert.deepEqual(accentsIn(out, 'P5__PL'), c.pl, `${c.name}: PL`);
}

// 분할되지 않은 편집기 XML(src index 없음)은 기존처럼 위치 noteIndex
const plain = xml.replace(/ data-hitl-src-note-index="\d+"/g, '');
const plainOut = applyArticulationPlacementFixesToPreviewXml(plain, [
  { ...base, partId: 'P5__PL', kind: 'addArticulation', noteIndex: 2 } as never,
]);
assert.deepEqual(accentsIn(plainOut, 'P5__PL'), ['F3']);

console.log('OK test_split_pr_art_fix_not_on_pl');
