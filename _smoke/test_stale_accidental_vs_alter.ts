/**
 * 음높이만 A♮→A♭로 고치고 남은 `<accidental>natural</accidental>`이
 * alter 기준으로 바로잡히는지(미리보기 TS + 저장 Python).
 *
 * npx vite-node _smoke/test_stale_accidental_vs_alter.ts
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { propagateAccidentalStatesForMusicXml } from '../shared/musicXmlAccidentalPropagation';

const dom = new JSDOM('');
Object.assign(globalThis, { DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer });

const note = (alter: string, acc: string) =>
  `<note><pitch><step>A</step>${alter}<octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>${acc}<staff>1</staff></note>`;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>2</divisions><key><fifths>-1</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
${note('<alter>-1</alter>', '<accidental>flat</accidental>')}${note('<alter>-1</alter>', '')}
${note('<alter>-1</alter>', '')}${note('<alter>-1</alter>', '')}
</measure>
<measure number="2">
${note('<alter>-1</alter>', '<accidental parentheses="yes">natural</accidental>')}${note('<alter>-1</alter>', '')}
${note('', '<accidental>natural</accidental>')}${note('<alter>1</alter>', '<accidental>sharp</accidental>')}
</measure>
</part></score-partwise>`;

let fail = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!ok) fail++;
};

function accsOfMeasure2(out: string): string[] {
  const doc = new DOMParser().parseFromString(out, 'application/xml');
  const m2 = [...doc.querySelectorAll('measure')].find((m) => m.getAttribute('number') === '2')!;
  return [...m2.querySelectorAll(':scope > note')].map((n) => {
    const a = n.querySelector('accidental');
    return a ? `${a.textContent}${a.getAttribute('parentheses') ? '()' : ''}` : '-';
  });
}

const expected = ['flat()', '-', 'natural', 'sharp'];
const ts = accsOfMeasure2(propagateAccidentalStatesForMusicXml(xml));
check(JSON.stringify(ts) === JSON.stringify(expected), `TS 미리보기 m2 임시표 ${ts.join(',')} = ${expected.join(',')}`);

const dir = mkdtempSync(join(tmpdir(), 'stale-acc-'));
const xmlPath = join(dir, 'in.xml');
writeFileSync(xmlPath, xml, 'utf8');
const py = `
import sys, xml.etree.ElementTree as ET
sys.path.insert(0, 'scripts')
from omr_hitl_lib import propagate_accidental_states_in_root, _ns
root = ET.parse(sys.argv[1]).getroot()
propagate_accidental_states_in_root(root, _ns(root))
m2 = [m for m in root.iter('measure') if m.get('number') == '2'][0]
out = []
for n in m2.findall('note'):
    a = n.find('accidental')
    out.append('-' if a is None else a.text + ('()' if a.get('parentheses') else ''))
print(','.join(out))
`;
const pyBin = process.platform === 'win32' ? 'venv\\Scripts\\python.exe' : 'venv/bin/python';
const pyOut = execFileSync(pyBin, ['-c', py, xmlPath], { encoding: 'utf8' }).trim();
check(pyOut === expected.join(','), `Python 저장 m2 임시표 ${pyOut} = ${expected.join(',')}`);

process.exit(fail ? 1 : 0);
