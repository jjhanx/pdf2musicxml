import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import {
  collectMeasureHitTargets,
  hitTestOsmdMeasure,
} from '../src/osmdMeasureClick';

function measureNotes(partKind: 'melody' | 'rest' | 'piano'): string {
  if (partKind === 'rest') {
    // Audiveris식: 온쉼표 + display-step 높게 (첫째줄 아래로 걸리는 사례)
    return `<note><rest><display-step>D</display-step><display-octave>5</display-octave></rest><duration>16</duration></note>`;
  }
  if (partKind === 'piano') {
    return `
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>half</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><type>half</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><type>whole</type><staff>2</staff></note>`;
  }
  return `
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    <note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note>`;
}

function part(id: string, kind: 'melody' | 'rest' | 'piano', measures: number): string {
  let xml = `<part id="${id}">`;
  for (let m = 1; m <= measures; m += 1) {
    xml += `<measure number="${m}">`;
    if (m === 1) {
      xml += `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>`;
      if (kind === 'piano') {
        xml += `<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>`;
      } else {
        xml += `<clef><sign>G</sign><line>2</line></clef>`;
      }
      xml += `</attributes>`;
    }
    xml += kind === 'rest' && m === 1 ? measureNotes('melody') : measureNotes(kind);
    xml += `</measure>`;
  }
  return `${xml}</part>`;
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>S</part-name></score-part>
    <score-part id="P2"><part-name>A</part-name></score-part>
    <score-part id="P3"><part-name>T</part-name></score-part>
    <score-part id="P4"><part-name>B</part-name></score-part>
    <score-part id="P"><part-name>Piano</part-name></score-part>
  </part-list>
  ${part('P1', 'melody', 5)}
  ${part('P2', 'rest', 5)}
  ${part('P3', 'melody', 5)}
  ${part('P4', 'rest', 5)}
  ${part('P', 'piano', 5)}
</score-partwise>`;

const host = document.getElementById('host') as HTMLDivElement;
const out = document.getElementById('out') as HTMLPreElement;
const COLORS = ['#e53935', '#8e24aa', '#3949ab', '#00897b', '#f9a825', '#6d4c41'];

const osmd = new OpenSheetMusicDisplay(host, { autoResize: false, backend: 'svg' });
osmd
  .load(XML)
  .then(() => {
    osmd.zoom = 0.6;
    osmd.render();
    setTimeout(() => {
      const targets = collectMeasureHitTargets(osmd, host);
      // 줄 밴드 시각화
      for (const t of targets) {
        const d = document.createElement('div');
        d.className = 'band';
        d.style.cssText += `top:${t.bounds.top}px;height:${t.bounds.bottom - t.bounds.top}px;left:${t.bounds.left}px;width:${t.bounds.right - t.bounds.left}px;position:absolute;background:${COLORS[t.staffIndex % COLORS.length]};`;
        host.appendChild(d);
      }
      const lines = targets
        .filter((t) => t.measureMxl <= 2)
        .map(
          (t) =>
            `si=${t.staffIndex} part=${t.partId} m=${t.measureMxl} top=${Math.round(t.bounds.top)} bottom=${Math.round(t.bounds.bottom)} left=${Math.round(t.bounds.left)} right=${Math.round(t.bounds.right)}`,
        );
      out.textContent = `targets=${targets.length}\n${lines.join('\n')}`;
      (window as unknown as Record<string, unknown>).__targets = targets;
    }, 300);
  })
  .catch((e) => {
    out.textContent = `OSMD load 실패: ${e}`;
  });

host.addEventListener('click', (evt) => {
  const hit = hitTestOsmdMeasure(osmd, host, evt);
  const r = host.getBoundingClientRect();
  out.textContent =
    `click(${Math.round(evt.clientX - r.left)},${Math.round(evt.clientY - r.top)}) → ` +
    (hit ? `m=${hit.measureMxl} staff=${hit.staffIndex} part=${hit.partId}` : 'null') +
    `\n\n${out.textContent}`;
});
