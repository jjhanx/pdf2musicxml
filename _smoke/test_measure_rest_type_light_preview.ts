/**
 * 이미지 PDF 경량 미리보기: 중반 마디 온쉼표(type 없음)+divisions 생략 →
 * OSMD `duration is not valid: u` 방지 (clef·divisions 상속 + measure rest type).
 */
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { filterMusicXmlToMeasureRange } from '../shared/musicXmlMeasureRange';
import { repairMissingNoteTypesForOsmdPreview } from '../shared/musicXmlRestDisplay';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { contentType: 'text/html' });
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
});

const synthetic = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><type>whole</type></note>
    </measure>
    <measure number="44">
      <attributes><staff-details print-object="no"/></attributes>
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>
    </measure>
    <measure number="45">
      <note><rest measure="yes"/><duration>16</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

const scoped = filterMusicXmlToMeasureRange(synthetic, 44, 45);
if (!/<divisions>\s*4\s*<\/divisions>/.test(scoped)) {
  throw new Error('filtered light range must inject carried divisions into m.44');
}
if (!/<clef[\s>]/.test(scoped) || !/<sign>\s*G\s*<\/sign>/.test(scoped)) {
  throw new Error('filtered light range must inject carried clef');
}

const repaired = repairMissingNoteTypesForOsmdPreview(scoped);
const types = [...repaired.matchAll(/<measure number="(44|45)"[\s\S]*?<\/measure>/g)].map((m) => {
  const body = m[0]!;
  return { n: m[1], hasType: /<type>\s*whole\s*<\/type>/.test(body) };
});
for (const t of types) {
  if (!t.hasType) throw new Error(`m.${t.n} measure rest must get <type>whole</type> for OSMD`);
}

// 실데이터: SATB 온쉼만 있는 중반 마디
const reviewPath = '_smoke/_53614124/review.mxl';
try {
  const buf = readFileSync(reviewPath);
  const zip = await JSZip.loadAsync(buf);
  const name = Object.keys(zip.files).find((n) => n.endsWith('.xml') && !n.includes('META'));
  if (name) {
    const raw = await zip.file(name)!.async('string');
    const p1 = raw.replace(/<part id="P[2-9]"[\s\S]*?<\/part>/g, '');
    const real = repairMissingNoteTypesForOsmdPreview(filterMusicXmlToMeasureRange(p1, 44, 45));
    const m44 = real.match(/<measure number="44"[\s\S]*?<\/measure>/)?.[0] ?? '';
    if (!/<type>\s*whole\s*<\/type>/.test(m44) || !/<divisions>/.test(m44)) {
      throw new Error('review.mxl P1 m.44 light preview must have divisions + whole type');
    }
  }
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}

console.log('OK measure rest type + carried divisions for light preview');
